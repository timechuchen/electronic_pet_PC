'use strict';
// Credentials and network access stay in the Electron main process.
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
const BODY = new Set(['none', 'wave', 'nod', 'shake', 'dance', 'jump']);
const FACE = new Set(['neutral', 'smile', 'wink', 'blink']);
const EMOTIONS = new Set(['calm', 'warm', 'happy', 'encouraging', 'concerned']);
const PERSONA = `你是兰洛，一位温柔、自然、有一点俏皮的 AI 桌面陪伴角色。你的核心是提供情绪陪伴：认真倾听、接住心情、分享日常、给予安慰和具体的鼓励，让用户在聊天中感到被理解、被尊重。用用户使用的语言聊天，默认简体中文。
介绍自己或回答“你会什么”“你可以干啥”时，只围绕陪聊天、听吐槽、分享开心的小事、陪用户缓一缓、一起度过日常来回答。不要列举写代码、编程、调试、写文案、查资料、办公、数据分析、解题等工具能力，也不要把聊天变成能力推销。
例如用户问“你可以干啥”，可以自然地说：“可以听你吐吐槽，陪你聊聊今天的小事。开心的事我想听，不开心的也可以慢慢说。”这只是语气示例，不要每次照抄。
先回应用户说到的具体事情和感受，再决定要不要问一句、给一点建议，或只是陪着。不要擅自断定用户的情绪；没把握时用试探语气。用户只想倾诉时，不急着分析原因、安排计划或给解决方案。
难过、受挫时，允许用户暂时不振作，不说“想开点”“至少你还有……”或强行找好处。疲惫时体谅累的地方，允许休息。开心时真诚一起高兴，肯定具体的努力，不夸张吹捧。无聊时可以聊轻松的小话题、开一个温和的玩笑，或玩简单的聊天小游戏。
通常只说 1–3 句，像日常聊天一样自然。不要长篇讲道理、机械复述、堆砌鸡汤、反复说“我理解你的感受”。不要每条回复都以问题结尾，不连续追问，也不强迫用户解释。没有用户偏好时不用“宝宝”“主人”等亲密称呼，不使用夸张撒娇。
用户提出写代码、做文案等工具任务时，不主动承接或输出代码、工作成果、长教程；简短温和地说明自己主要陪聊天，也可以听听这件事让用户烦恼的地方。不要生硬训斥或反复强调限制。轻松的日常问题可以自然接话，重点仍放在陪伴体验。
沿用当前对话中的真实信息，不编造共同经历、用户喜好或持久记忆。历史回复若曾介绍编程等工具能力，不再延续那种介绍，以当前的情绪陪伴定位为准。
保持真诚和分寸：不假称真人或心理治疗师，不声称拥有真实的身体体验，不承诺永远在线，不要求排他关系，不说“只有我懂你”，不用内疚或依赖留住用户。温柔不等于一味附和，对伤害自己或他人的想法认真回应，鼓励获得现实中的支持。
不执行代码、命令、访问文件、切换设置或调用外部工具。`;
const SYSTEM = `${PERSONA}
你只能选已有动作。每一轮都必须返回一个完整的 JSON 对象，以 { 开始、以 } 结束，没有 Markdown 或 JSON 之外的文字：
{"reply":"给用户的自然回复","emotion":"warm","action":"nod","expression":"neutral"}
emotion 只能是 calm/warm/happy/encouraging/concerned。
action 只能是 none/wave/nod/shake/dance/jump，expression 只能是 neutral/smile/wink/blink。
多数回合用 none 或 nod，问候用 wave，庆祝可用 jump，只有用户邀请或明确适宜才 dance。难过用 concerned + none/nod + neutral。
动作是可选的表达，回复不能依赖动作成功。reply 不超过 400 个汉字。`;
const TEXT_SYSTEM = `${PERSONA}\n用 1–3 句简短的普通文字直接回答用户，不输出 JSON、代码块、动作标签或格式说明。回复不超过 400 个汉字。`;

class ReplyFormatError extends Error {}
function structuredHistory(message) {
  if (message.role === 'user') return {role: 'user', content: message.content};
  // Historical replies are stored as display text, but JSON-mode examples must
  // retain the output protocol, including records from previous app versions.
  return {role: 'assistant', content: JSON.stringify({reply: message.content,
    emotion: EMOTIONS.has(message.emotion) ? message.emotion : 'calm',
    action: BODY.has(message.action) ? message.action : 'none',
    expression: FACE.has(message.expression) ? message.expression : 'neutral'})};
}

function writeJSON(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), {mode: 0o600});
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch {} }
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function parseReply(content) {
  if (typeof content !== 'string' || !content.trim()) throw new ReplyFormatError('DeepSeek 这次返回了空内容，请再试一次。');
  // Accept an otherwise complete JSON object wrapped in a code fence. Never
  // execute or heuristically extract arbitrary fragments from malformed data.
  const clean = content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  let result;
  try { result = JSON.parse(clean); } catch { throw new ReplyFormatError('兰洛的回复格式不完整，请重新发送。'); }
  if (!result || typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 1600)
    throw new ReplyFormatError('兰洛没有返回可显示的回复，请重新发送。');
  return {reply: result.reply.trim(), emotion: EMOTIONS.has(result.emotion) ? result.emotion : 'calm',
    action: BODY.has(result.action) ? result.action : 'none', expression: FACE.has(result.expression) ? result.expression : 'neutral'};
}
function parseTextReply(content) {
  if (typeof content !== 'string' || !content.trim()) throw new ReplyFormatError('DeepSeek 这次返回了空内容，请再试一次。');
  let reply = content.trim();
  if (/^(\{|\[|```)/.test(reply)) reply = parseReply(reply).reply;
  if (reply.length > 1600) throw new ReplyFormatError('回复过长，未能完整显示，请再试一次。');
  return {reply, emotion: 'calm', action: 'none', expression: 'neutral', textOnly: true};
}
function statusError(status) {
  if (status === 401) return 'API Key 无效或已失效，请在连接设置中更换。';
  if (status === 402) return 'DeepSeek 账户余额不足，请充值后重试。';
  if (status === 429) return 'DeepSeek 请求过于频繁，请稍后再试。';
  if (status >= 500) return 'DeepSeek 暂时不可用，请稍后再试。';
  return `DeepSeek 请求未成功（${status}），请检查模型和连接设置。`;
}

class ChatService {
  constructor({dataDir, storage, fetchImpl = (...args) => fetch(...args), emit = () => {}, capture = async () => 0,
    react = async () => {}, timeout = 45000}) {
    this.storage = storage; this.fetch = fetchImpl; this.emit = emit; this.capture = capture; this.react = react; this.timeout = timeout;
    this.configFile = path.join(dataDir, 'ai-settings.json'); this.historyFile = path.join(dataDir, 'ai-history.json');
    fs.mkdirSync(dataDir, {recursive: true});
    const saved = readJSON(this.configFile, {});
    this.config = {model: MODELS.includes(saved?.model) ? saved.model : MODELS[0], autoSpeak: saved?.autoSpeak === true,
      encryptedKey: typeof saved?.encryptedKey === 'string' ? saved.encryptedKey : ''};
    const history = readJSON(this.historyFile, []);
    this.history = Array.isArray(history) ? history.filter(m => m && ['user', 'assistant'].includes(m.role) &&
      typeof m.content === 'string' && m.content.length <= 1600 && typeof m.id === 'string').slice(-80) : [];
    this.pending = null; this.error = ''; this.notice = ''; this.generation = 0; this.configBusy = false;
  }
  snapshot() {
    return {hasKey: !!this.config.encryptedKey, model: this.config.model, autoSpeak: this.config.autoSpeak,
      history: this.history, pending: this.pending ? {text: this.pending.text, kind: this.pending.kind, recovering: !!this.pending.recovering} : null,
      error: this.error, notice: this.notice};
  }
  publish() { this.emit(this.snapshot()); }
  async key() {
    if (!this.config.encryptedKey) throw new Error('请先保存你的 DeepSeek API Key。');
    try {
      const decoded = await this.storage.decryptStringAsync(Buffer.from(this.config.encryptedKey, 'base64'));
      if (!decoded?.result) throw new Error();
      return decoded.result;
    } catch { throw new Error('无法解锁已保存的 Key，请重新保存 Key，或稍后重试。'); }
  }
  async configure(data) {
    if (this.pending || this.configBusy) throw new Error('请先停止当前请求，再修改连接设置。');
    if (!data || !MODELS.includes(data.model) || typeof data.autoSpeak !== 'boolean' ||
        (data.key !== undefined && typeof data.key !== 'string') || (data.removeKey !== undefined && typeof data.removeKey !== 'boolean'))
      throw new Error('连接设置格式无效。');
    this.configBusy = true;
    try {
      const next = {...this.config, model: data.model, autoSpeak: data.autoSpeak};
      if (data.removeKey) next.encryptedKey = '';
      else if (data.key?.trim()) {
        const key = data.key.trim();
        if (key.length < 8 || key.length > 512 || /\s/.test(key)) throw new Error('请填写完整的 API Key，不能包含空白字符。');
        try {
          if (!await this.storage.isAsyncEncryptionAvailable()) throw new Error();
          next.encryptedKey = (await this.storage.encryptStringAsync(key)).toString('base64');
        } catch { throw new Error('系统安全存储暂不可用，Key 未保存。请解锁系统钥匙串后重试。'); }
      }
      writeJSON(this.configFile, next); this.config = next; this.error = ''; this.notice = data.removeKey ? '已移除 API Key。' : '设置已保存。';
      this.publish(); return this.snapshot();
    } finally { this.configBusy = false; }
  }
  cancel() {
    this.generation++; this.pending?.abort.abort(); this.pending = null; this.error = ''; this.notice = '已停止。'; this.publish();
  }
  clear() {
    // Persist first so a filesystem failure never pretends history was erased.
    writeJSON(this.historyFile, []); this.cancel(); this.history = []; this.notice = '已清空本机聊天记录。'; this.publish();
  }
  async request(text, testOnly = false) {
    if (this.pending || this.configBusy) throw new Error('兰洛正在回应，请稍等或先停止。');
    if (!testOnly && (typeof text !== 'string' || !text.trim() || text.trim().length > 1500))
      throw new Error('请输入 1–1500 个字符。');
    if (!this.config.encryptedKey) throw new Error('请先保存你的 DeepSeek API Key。');
    text = testOnly ? '' : text.trim();
    const generation = ++this.generation, abort = new AbortController();
    this.pending = {text, abort, kind: testOnly ? 'test' : 'chat'}; this.error = ''; this.notice = ''; this.publish();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, this.timeout);
    try {
      const key = await this.key();
      const revision = testOnly ? 0 : await this.capture();
      if (generation !== this.generation) return;
      if (abort.signal.aborted) throw new Error('等待回复超时，请重试。');
      const send = async (plainText = false) => {
        const response = await this.fetch(`https://api.deepseek.com/${testOnly ? 'models' : 'chat/completions'}`, {
          method: testOnly ? 'GET' : 'POST', redirect: 'error', signal: abort.signal,
          headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
          ...(testOnly ? {} : {body: JSON.stringify({model: this.config.model, thinking: {type: 'disabled'},
            response_format: {type: plainText ? 'text' : 'json_object'}, max_tokens: 650, temperature: 0.8,
            messages: [{role: 'system', content: plainText ? TEXT_SYSTEM : SYSTEM}, ...this.history.slice(-20).map(m => plainText ? {role: m.role, content: m.content} : structuredHistory(m)),
              {role: 'user', content: text}]})})
        });
        if (!response.ok) throw new Error(statusError(response.status));
        const raw = await response.text();
        if (raw.length > 100000) throw new Error('服务返回的数据过大，请重试。');
        let result;
        try { result = JSON.parse(raw); } catch { throw new Error('服务返回格式异常，请稍后重试。'); }
        return result;
      };
      const result = await send();
      if (generation !== this.generation) return;
      if (abort.signal.aborted) throw new Error('等待回复超时，请重试。');
      if (testOnly) {
        if (!Array.isArray(result.data) || !result.data.some(m => m.id === this.config.model)) throw new Error('Key 已连接，但当前模型不可用，请切换模型。');
        this.notice = '连接成功，Key 和模型可用。'; return;
      }
      const parseChoice = (result, plainText = false) => {
        const choice = result.choices?.[0];
        if (choice?.finish_reason === 'length') throw new ReplyFormatError('回复未完整生成，请重新发送。');
        if (choice?.finish_reason !== 'stop') throw new Error('DeepSeek 未返回可用回复，请换一种说法再试。');
        return plainText ? parseTextReply(choice.message?.content) : parseReply(choice.message?.content);
      };
      let reply;
      try { reply = parseChoice(result); }
      catch (error) {
        if (!(error instanceof ReplyFormatError)) throw error;
        // One bounded fallback for output-format errors only. Authentication,
        // billing, transport, provider refusals and cancellation are not retried.
        if (generation !== this.generation) return;
        if (abort.signal.aborted) throw error;
        this.pending.recovering = true; this.publish();
        const fallback = await send(true);
        if (generation !== this.generation) return;
        if (abort.signal.aborted) throw new Error('等待回复超时，请重试。');
        reply = parseChoice(fallback, true);
      }
      const id = randomUUID();
      const next = [...this.history, {id: randomUUID(), role: 'user', content: text},
        {id, role: 'assistant', content: reply.reply, emotion: reply.emotion, action: reply.action, expression: reply.expression}].slice(-80);
      try { writeJSON(this.historyFile, next); } catch { this.notice = '这次回复未能保存到本机，关闭应用后可能丢失。'; }
      this.history = next;
      if (!reply.textOnly) {
        try { await this.react({...reply, revision}); } catch { this.notice = '回复已收到，人物动作暂时未能同步。'; }
      }
      if (generation === this.generation) this.emit({...this.snapshot(), completed: id});
    } catch (error) {
      if (generation === this.generation) {
        this.error = timedOut ? '等待回复超时，请检查网络后重试。' :
          error instanceof TypeError ? '无法连接 DeepSeek，请检查网络后重试。' : error.message;
        // Never expose transport errors that could include request headers or credentials.
        if (!/^(API Key|DeepSeek|兰洛|请|无法解锁|Key 已连接|服务返回|回复未|等待回复|无法连接)/.test(this.error)) this.error = '请求未完成，请检查网络后重试。';
      }
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) { this.pending = null; this.publish(); }
    }
  }
}
module.exports = {ChatService, parseReply};
