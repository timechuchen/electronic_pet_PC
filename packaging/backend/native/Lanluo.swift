import AppKit
import WebKit
import ScreenCaptureKit
import SoundAnalysis
import AVFoundation
import CoreMedia

func argument(_ key: String, fallback: String = "") -> String {
    guard let i = CommandLine.arguments.firstIndex(of: key), i + 1 < CommandLine.arguments.count else { return fallback }
    return CommandLine.arguments[i + 1]
}
let baseURL = argument("--url", fallback: "http://127.0.0.1:8765")
let nativeToken = argument("--native-token")

func apiRequest(_ path: String, body: [String: Any]? = nil, completion: (([String: Any]?) -> Void)? = nil) {
    guard let url = URL(string: baseURL + path) else { return }
    var req = URLRequest(url: url); req.timeoutInterval = 5
    req.setValue(nativeToken, forHTTPHeaderField: "X-Pet-Token")
    if let body = body {
        req.httpMethod = "POST"; req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    URLSession.shared.dataTask(with: req) { data, response, error in
        let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        completion?(json)
    }.resume()
}

// Only audio samples are registered: no screen image buffers or microphone input.
final class SystemMusic: NSObject, SCStreamOutput, SCStreamDelegate, SNResultsObserving {
    var stream: SCStream?
    var analyzer: SNAudioStreamAnalyzer?
    let queue = DispatchQueue(label: "lanluo.audio.analysis")
    var framePosition: AVAudioFramePosition = 0
    var format: AVAudioFormat?
    var running = false
    var audioActive = false
    var generation = 0
    var level: Double = 0
    var score: Double = 0
    var lastReport = Date.distantPast
    var lastSound = Date.distantPast
    var musicLabels: Set<String> = ["music"]
    var heartbeat: Timer?

    func report(_ status: String, _ message: String) {
        queue.async { apiRequest("/api/audio", body: ["status": status, "message": message, "score": self.score, "level": self.level]) }
    }
    func start() {
        guard !running else { return }
        running = true; queue.async { self.audioActive = true }; generation += 1; let current = generation
        report("starting", "等待 macOS 系统音频授权…")
        Task { @MainActor [self] in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard self.running && current == self.generation else { return }
                guard let display = content.displays.first else { throw NSError(domain: "Lanluo", code: 1, userInfo: [NSLocalizedDescriptionKey: "没有可捕捉的显示器"]) }
                let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
                let config = SCStreamConfiguration()
                config.capturesAudio = true; config.excludesCurrentProcessAudio = true
                config.sampleRate = 48000; config.channelCount = 2
                config.width = 2; config.height = 2
                config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                if #available(macOS 15.0, *) { config.captureMicrophone = false }
                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: self.queue)
                self.stream = stream
                try await stream.startCapture()
                guard self.running && current == self.generation else { try? await stream.stopCapture(); return }
                self.report("listening", "正在识别系统音频（不使用麦克风）")
                self.heartbeat = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
                    guard let self = self else { return }
                    self.queue.async {
                        // Silence can stop producing buffers; never keep an old music score alive.
                        if Date().timeIntervalSince(self.lastSound) > 1.5 { self.level = 0; self.score = 0 }
                        self.report("listening", "正在识别系统音频")
                    }
                }
            } catch {
                guard current == self.generation else { return }
                self.stop(report: false)
                self.report("error", "无法读取系统音频：\(error.localizedDescription)。请在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中允许“兰洛桌宠”，然后重试。")
            }
        }
    }
    func stop(report shouldReport: Bool = true) {
        running = false; generation += 1
        heartbeat?.invalidate(); heartbeat = nil
        let old = stream; stream = nil
        Task { try? await old?.stopCapture() }
        queue.async { self.audioActive = false; self.analyzer?.removeAllRequests(); self.analyzer = nil; self.format = nil; self.framePosition = 0; self.score = 0; self.level = 0 }
        if shouldReport { report("off", "系统音频监听已停止") }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        DispatchQueue.main.async { guard self.stream === stream else { return }; self.stop(report: false); self.report("error", "系统音频中断：\(error.localizedDescription)") }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard audioActive, outputType == .audio, sampleBuffer.isValid,
              let description = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        let audioFormat = AVAudioFormat(cmAudioFormatDescription: description)
        let count = CMSampleBufferGetNumSamples(sampleBuffer)
        guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: AVAudioFrameCount(count)) else { return }
        buffer.frameLength = AVAudioFrameCount(count)
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sampleBuffer, at: 0, frameCount: Int32(count), into: buffer.mutableAudioBufferList) == noErr else { return }
        if let channels = buffer.floatChannelData {
            var sum: Double = 0
            for i in 0..<count { let value = Double(channels[0][i]); sum += value * value }
            level = min(1, sqrt(sum / Double(count)))
            if level > 0.001 { lastSound = Date() }
        }
        if analyzer == nil || format != audioFormat {
            do {
                let classifier = try SNClassifySoundRequest(classifierIdentifier: .version1)
                classifier.windowDuration = CMTime(seconds: 1.5, preferredTimescale: 48000)
                classifier.overlapFactor = 0.5
                musicLabels = Set(classifier.knownClassifications.filter { $0 == "music" || $0.hasSuffix("_music") })
                let next = SNAudioStreamAnalyzer(format: audioFormat)
                try next.add(classifier, withObserver: self)
                analyzer = next; format = audioFormat; framePosition = 0
            } catch {
                DispatchQueue.main.async { self.stop(report: false); self.report("error", "音乐分类器启动失败：\(error.localizedDescription)") }; return
            }
        }
        analyzer?.analyze(buffer, atAudioFramePosition: framePosition)
        framePosition += AVAudioFramePosition(count)
    }
    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let result = result as? SNClassificationResult else { return }
        let classifications = result.classifications
        queue.async { self.score = classifications.filter { self.musicLabels.contains($0.identifier) }.map(\.confidence).max() ?? 0 }
    }
    func request(_ request: SNRequest, didFailWithError error: Error) {
        DispatchQueue.main.async { self.stop(report: false); self.report("error", "音乐识别失败：\(error.localizedDescription)") }
    }
    func requestDidComplete(_ request: SNRequest) {}
}

final class PetWindow: NSWindow { override var canBecomeKey: Bool { true } }
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var window: PetWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var timer: Timer?
    let audio = SystemMusic()
    var showSerial = -1
    var dragOrigin = NSPoint.zero
    var failures = 0
    var clickItem: NSMenuItem!
    var topItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        if CommandLine.arguments.contains("--audio-only") {
            timer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in self?.poll() }
            return
        }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "desktop")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        window = PetWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 470), styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        window.title = "兰洛桌宠"; window.isOpaque = false; window.backgroundColor = .clear
        window.hasShadow = false; window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false; window.minSize = NSSize(width: 220, height: 300)
        window.contentView = web
        if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            window.setFrameOrigin(NSPoint(x: frame.maxX - 390, y: frame.minY + 20))
        }
        web.load(URLRequest(url: URL(string: baseURL + "/?desktop=1")!))
        window.orderFrontRegardless()
        buildMenu()
        timer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in self?.poll() }
        if CommandLine.arguments.contains("--smoke-test") {
            Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { timer in
                self.web.evaluateJavaScript("window.petDiagnostics?.()") { result, error in
                    if let result = result as? [String: Any], result["ready"] as? Bool == true {
                        print("DESKTOP_READY transparent=\(!self.window.isOpaque) onTop=\(self.window.level == .floating) webgl=true")
                        timer.invalidate()
                        self.web.takeSnapshot(with: nil) { image, _ in
                            if let image = image, let data = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
                                try? png.write(to: URL(fileURLWithPath: argument("--snapshot", fallback: "/tmp/lanluo-desktop.png")))
                            }
                            timer.invalidate(); NSApp.terminate(nil)
                        }
                    }
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 35) { print("DESKTOP_SMOKE_TIMEOUT"); NSApp.terminate(nil) }
        }
    }
    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "兰"
        let menu = NSMenu()
        func item(_ title: String, _ selector: Selector) -> NSMenuItem { let item = NSMenuItem(title: title, action: selector, keyEquivalent: ""); item.target = self; menu.addItem(item); return item }
        _ = item("显示兰洛", #selector(showPet)); _ = item("打开控制面板", #selector(openControl))
        menu.addItem(.separator())
        topItem = item("始终置顶", #selector(toggleTop)); topItem.state = .on
        clickItem = item("鼠标穿透（从此菜单恢复）", #selector(toggleClick))
        menu.addItem(.separator()); _ = item("退出桌宠与音频监听", #selector(quit))
        statusItem.menu = menu
    }
    @objc func showPet() { window?.orderFrontRegardless() }
    @objc func openControl() { NSWorkspace.shared.open(URL(string: baseURL)!) }
    @objc func toggleTop() { window.level = window.level == .floating ? .normal : .floating; topItem.state = window.level == .floating ? .on : .off }
    @objc func toggleClick() { window.ignoresMouseEvents.toggle(); clickItem.state = window.ignoresMouseEvents ? .on : .off }
    @objc func quit() { NSApp.terminate(nil) }
    func poll() {
        apiRequest("/api/native") { data in
            DispatchQueue.main.async {
                guard let data = data else { self.failures += 1; if self.failures > 8 { NSApp.terminate(nil) }; return }
                self.failures = 0
                let serial = data["show"] as? Int ?? 0
                if serial != self.showSerial { self.showSerial = serial; self.showPet() }
                let enabled = data["audio_requested"] as? Bool ?? false
                if enabled && !self.audio.running { self.audio.start() }
                if !enabled && self.audio.running { self.audio.stop() }
            }
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              url.host == "127.0.0.1", url.port == URL(string: baseURL)?.port,
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "dragStart": dragOrigin = window.frame.origin
        case "drag":
            if let dx = body["dx"] as? Double, let dy = body["dy"] as? Double, dx.isFinite, dy.isFinite { window.setFrameOrigin(NSPoint(x: dragOrigin.x + dx, y: dragOrigin.y - dy)) }
        case "close": quit()
        case "control": openControl()
        case "top": toggleTop()
        case "clickThrough": toggleClick()
        default: break
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        decisionHandler(url?.host == "127.0.0.1" && url?.port == URL(string: baseURL)?.port ? .allow : .cancel)
    }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); audio.stop() }
}

final class FileMusicProbe: NSObject, SNResultsObserving {
    var maximum = 0.0
    var results = 0
    func request(_ request: SNRequest, didProduce result: SNResult) {
        if let result = result as? SNClassificationResult { maximum = max(maximum, result.classifications.first(where: { $0.identifier == "music" })?.confidence ?? 0); results += 1 }
    }
    func request(_ request: SNRequest, didFailWithError error: Error) { print("CLASSIFICATION_ERROR \(error)") }
    func requestDidComplete(_ request: SNRequest) {}
}
if CommandLine.arguments.contains("--classify-file") {
    do {
        let observer = FileMusicProbe()
        let analyzer = try SNAudioFileAnalyzer(url: URL(fileURLWithPath: argument("--classify-file")))
        let classifier = try SNClassifySoundRequest(classifierIdentifier: .version1)
        classifier.windowDuration = CMTime(seconds: 1.5, preferredTimescale: 48000); classifier.overlapFactor = 0.5
        try analyzer.add(classifier, withObserver: observer)
        analyzer.analyze()
        print("FILE_CLASSIFICATION results=\(observer.results) maximumMusicConfidence=\(observer.maximum)")
        exit(observer.results > 0 ? 0 : 1)
    } catch { print("FILE_CLASSIFICATION_ERROR \(error)"); exit(1) }
}
if CommandLine.arguments.contains("--self-test-audio") {
    do {
        let classifier = try SNClassifySoundRequest(classifierIdentifier: .version1)
        let labels = classifier.knownClassifications.filter { $0 == "music" || $0.hasSuffix("_music") }
        guard !labels.isEmpty else { fatalError("No music classification available") }
        print("SOUND_CLASSIFIER_OK labels=\(labels.joined(separator: ","))")
        exit(0)
    } catch { print("SOUND_CLASSIFIER_ERROR \(error)"); exit(1) }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
