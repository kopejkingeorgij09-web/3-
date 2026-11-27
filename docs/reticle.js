import {readStorage,writeStorage} from './storage.js';

const storageKey = 'stormcore-reticle';
const defaultReticle = {shape:'cross',color:'#91ffe4',size:30,thickness:3,dot:true};
const shapes = ['cross','ring','dot'];

function pixels(value,min,max,step,fallback) {
  return Number.isFinite(value) ? Math.min(max,Math.max(min,Math.round(value/step)*step)) : fallback;
}

function normalizeReticle(value) {
  return {
    shape:shapes.includes(value?.shape) ? value.shape : defaultReticle.shape,
    color:typeof value?.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color)
      ? value.color.toLowerCase() : defaultReticle.color,
    size:pixels(value?.size,22,52,2,defaultReticle.size),
    thickness:pixels(value?.thickness,2,5,1,defaultReticle.thickness),
    dot:typeof value?.dot === 'boolean' ? value.dot : defaultReticle.dot
  };
}

export function initReticle(aim,dialog) {
  const field = id=>dialog.querySelector('#'+id);
  const shape = field('reticleShape');
  const color = field('reticleColor');
  const size = field('reticleSize');
  const thickness = field('reticleThickness');
  const dot = field('reticleDot');
  const sizeValue = field('reticleSizeValue');
  const thicknessValue = field('reticleThicknessValue');
  const swatches = [...dialog.querySelectorAll('[data-reticle-color]')];
  const previews = [...dialog.querySelectorAll('[data-reticle-preview]')];
  const glyph = aim.querySelector('.reticle-glyph');
  for (const preview of previews) preview.append(glyph.cloneNode(true));
  const views = [aim,...previews];

  let settings = defaultReticle;
  try {settings = normalizeReticle(JSON.parse(readStorage(storageKey)));} catch {}

  function show() {
    for (const view of views) {
      view.dataset.shape = settings.shape;
      view.dataset.dot = String(settings.dot);
      view.style.setProperty('--reticle-color',settings.color);
      view.style.setProperty('--reticle-size',settings.size+'px');
      view.style.setProperty('--reticle-thickness',settings.thickness+'px');
    }
    shape.value = settings.shape;
    if (color.value !== settings.color) color.value = settings.color;
    size.value = settings.size;
    thickness.value = settings.thickness;
    dot.checked = settings.dot;
    dot.disabled = settings.shape === 'dot';
    sizeValue.value = settings.size+' px';
    thicknessValue.value = settings.thickness+' px';
    for (const swatch of swatches) swatch.setAttribute('aria-pressed',String(swatch.dataset.reticleColor === settings.color));
  }

  function set(next) {
    const value = normalizeReticle(next);
    if (Object.keys(defaultReticle).every(key=>value[key]===settings[key])) return;
    settings = value;
    show();
    try {writeStorage(storageKey,JSON.stringify(settings));} catch {}
  }

  const changeColor = ()=>set({...settings,color:color.value});
  shape.addEventListener('change',()=>set({...settings,shape:shape.value}));
  color.addEventListener('input',changeColor);
  color.addEventListener('change',changeColor);
  size.addEventListener('input',()=>set({...settings,size:size.valueAsNumber}));
  thickness.addEventListener('input',()=>set({...settings,thickness:thickness.valueAsNumber}));
  dot.addEventListener('change',()=>set({...settings,dot:dot.checked}));
  for (const swatch of swatches) {
    swatch.addEventListener('click',()=>set({...settings,color:swatch.dataset.reticleColor}));
  }
  field('reticleReset').addEventListener('click',()=>set(defaultReticle));

  let opener;
  for (const button of document.querySelectorAll('[data-reticle-open]')) {
    button.addEventListener('click',()=>{
      opener = button;
      button.closest('dialog').close();
      dialog.showModal();
    });
  }
  dialog.addEventListener('close',()=>{
    if (!opener) return;
    opener.closest('dialog').showModal();
    opener.focus();
    opener = null;
  });

  show();
}
