import { DirectionalLight, MathUtils, Mesh, PlaneGeometry, ShadowMaterial, Vector2 } from 'three';

export function createDesktopShadow(renderer, scene) {
  // The light only supplies a shadow map. The character still displays its original colors.
  const sun = new DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.00015;

  const ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({
    color: 0x10141b,
    opacity: 0.32,
    depthWrite: false,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.renderOrder = -1;
  const viewport = new Vector2(1, 1);
  ground.onBeforeRender = () => renderer.getDrawingBufferSize(viewport);
  ground.material.onBeforeCompile = shader => {
    shader.uniforms.shadowViewport = { value: viewport };
    shader.fragmentShader = `uniform vec2 shadowViewport;\n${shader.fragmentShader}`.replace(
      '#include <tonemapping_fragment>',
      `vec2 screenUv = gl_FragCoord.xy / shadowViewport;
       gl_FragColor.a *= smoothstep(0.0, 0.075, min(screenUv.x, 1.0 - screenUv.x));
       gl_FragColor.a *= smoothstep(0.0, 0.06, screenUv.y);
       #include <tonemapping_fragment>`,
    );
  };
  scene.add(ground, sun, sun.target);

  let height = 0;
  let settings;
  function update() {
    const visible = Boolean(height && settings?.enabled);
    ground.visible = sun.visible = renderer.shadowMap.enabled = visible;
    if (!visible) return;

    const direction = MathUtils.degToRad(settings.direction);
    const elevation = MathUtils.degToRad(settings.elevation);
    const distance = height * 4;
    const horizontal = Math.cos(elevation) * distance;
    sun.target.position.y = height * 0.5;
    sun.position.set(
      -Math.cos(direction) * horizontal,
      sun.target.position.y + Math.sin(elevation) * distance,
      -Math.sin(direction) * horizontal,
    );
    const camera = sun.shadow.camera;
    camera.left = camera.bottom = -height * 1.5;
    camera.right = camera.top = height * 1.5;
    camera.near = Math.max(0.001, height * 0.1);
    camera.far = height * 7;
    camera.updateProjectionMatrix();
    ground.position.y = -height * 0.002;
    ground.scale.set(height * 6, height * 6, 1);
  }

  update();
  return {
    resize(value) { height = value; update(); },
    apply(value) { settings = value; update(); },
  };
}

export function watchDesktopShadow(api, apply) {
  api?.onShadowSettings?.(apply);
  return api?.getShadowSettings?.().then(settings => { if (settings) apply(settings); });
}

export function initShadowControls(toast) {
  const api = window.lanluoDesktop;
  if (!api?.setShadowSettings) return;
  const panel = document.getElementById('desktop-shadow-settings');
  const enabled = document.getElementById('shadow-enabled');
  const direction = document.getElementById('shadow-direction');
  const elevation = document.getElementById('shadow-elevation');
  const angleInputs = [direction, elevation];

  function showAngle(input) {
    const text = `${input.value}°`;
    document.getElementById(`${input.id}-value`).value = text;
    input.setAttribute('aria-valuetext', text);
  }

  function render(settings) {
    panel.hidden = false;
    enabled.checked = settings.enabled;
    direction.value = settings.direction;
    elevation.value = settings.elevation;
    for (const input of angleInputs) {
      input.disabled = !settings.enabled;
      showAngle(input);
    }
  }

  let saved;
  const apply = settings => { saved = settings; render(settings); };
  async function save(changes) {
    try { apply(await api.setShadowSettings(changes)); }
    catch(error) {
      if (saved) render(saved);
      toast(`阴影设置未能保存：${error.message}`);
    }
  }
  enabled.addEventListener('change', () => save({ enabled: enabled.checked }));
  for (const [key, input] of [['direction', direction], ['elevation', elevation]]) {
    input.addEventListener('input', () => showAngle(input));
    input.addEventListener('change', () => save({ [key]: input.valueAsNumber }));
  }
  watchDesktopShadow(api, apply).catch(error => toast(`阴影设置未能读取：${error.message}`));
}
