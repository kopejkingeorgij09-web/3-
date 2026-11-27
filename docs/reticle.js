import {readStorage,writeStorage} from './storage.js';

const storageKey = 'stormcore-reticle';
const defaults = {shape:'cross',color:'#91ffe4',wingColor:'#ffcb76',size:30,thickness:3,gap:14,dot:true,dotSize:4,outline:1,opacity:100};
const shapes = ['cross','ring','diamond','dot'];
const presets = {
  precise:{shape:'cross',size:26,thickness:2,gap:12,dot:true,dotSize:3,outline:1,opacity:100},
  ring:{shape:'ring',size:36,thickness:2,dot:true,dotSize:4,outline:1,opacity:95},
  bold:{shape:'cross',size:54,thickness:5,gap:22,dot:true,dotSize:6,outline:2,opacity:100}
};

const validColor = (value,fallback)=>typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
function bounded(value,min,max,step,fallback) {
  return Number.isFinite(value) ? Math.min(max,Math.max(min,Math.round(value/step)*step)) : fallback;
}

export function normalizeReticle(value) {
  const size = bounded(value?.size,22,64,2,defaults.size);
  return {
    shape:shapes.includes(value?.shape) ? value.shape : defaults.shape,
    color:validColor(value?.color,defaults.color),
    wingColor:validColor(value?.wingColor,defaults.wingColor),
    size,
    thickness:bounded(value?.thickness,1,7,1,defaults.thickness),
    gap:bounded(value?.gap,4,Math.min(28,size-6),1,defaults.gap),
    dot:typeof value?.dot === 'boolean' ? value.dot : defaults.dot,
    dotSize:bounded(value?.dotSize,2,14,1,defaults.dotSize),
    outline:bounded(value?.outline,0,3,1,defaults.outline),
    opacity:bounded(value?.opacity,35,100,5,defaults.opacity)
  };
}

export function initReticle(main,wing,dialog,template) {
  const field = id=>dialog.querySelector('#reticle'+id);
  const shape = field('Shape'), color = field('Color'), dot = field('Dot');
  const previewShip = field('PreviewShip');
  const previews = [...dialog.querySelectorAll('[data-reticle-preview]')];
  const swatches = [...dialog.querySelectorAll('[data-reticle-color]')];
  const sliders = ['size','thickness','gap','dotSize','outline','opacity'].map(key=>{
    const id = key[0].toUpperCase()+key.slice(1);
    return {key,input:field(id),output:field(id+'Value')};
  });
  for (const view of [main,wing,...previews]) view.append(template.content.cloneNode(true));

  let settings = defaults;
  try { settings = normalizeReticle(JSON.parse(readStorage(storageKey))); } catch {}
  const colorKey = ()=>previewShip.value === 'wingColor' ? 'wingColor' : 'color';

  function paint(view,ink) {
    view.dataset.shape = settings.shape;
    view.dataset.dot = String(settings.dot);
    const vars = {
      color:ink,size:settings.size+'px',thickness:settings.thickness+'px',gap:settings.gap+'px',
      dot:settings.dotSize+'px',outline:settings.outline+'px',opacity:settings.opacity/100
    };
    for (const [key,value] of Object.entries(vars)) view.style.setProperty('--reticle-'+key,value);
  }

  function show() {
    const ink = settings[colorKey()];
    paint(main,settings.color);
    paint(wing,settings.wingColor);
    for (const preview of previews) paint(preview,ink);
    shape.value = settings.shape;
    if (color.value !== ink) color.value = ink;
    dot.checked = settings.dot;
    dot.disabled = settings.shape === 'dot';
    for (const {key,input,output} of sliders) {
      if (key === 'gap') input.max = Math.min(28,settings.size-6);
      input.value = settings[key];
      input.disabled = key === 'gap' && settings.shape !== 'cross' ||
        (key === 'size' || key === 'thickness') && settings.shape === 'dot' ||
        key === 'dotSize' && settings.shape !== 'dot' && !settings.dot;
      output.value = settings[key]+(key === 'opacity' ? '%' : ' px');
    }
    for (const swatch of swatches) swatch.setAttribute('aria-pressed',String(swatch.dataset.reticleColor===ink));
  }

  function save(patch) {
    const next = normalizeReticle({...settings,...patch});
    if (Object.keys(defaults).every(key=>next[key]===settings[key])) return;
    settings = next;
    show();
    try { writeStorage(storageKey,JSON.stringify(settings)); } catch {}
  }

  previewShip.addEventListener('change',show);
  shape.addEventListener('change',()=>save({shape:shape.value}));
  dot.addEventListener('change',()=>save({dot:dot.checked}));
  const changeColor = ()=>save({[colorKey()]:color.value});
  color.addEventListener('input',changeColor);
  color.addEventListener('change',changeColor);
  for (const {key,input} of sliders) input.addEventListener('input',()=>save({[key]:input.valueAsNumber}));
  for (const swatch of swatches) swatch.addEventListener('click',()=>save({[colorKey()]:swatch.dataset.reticleColor}));
  for (const button of dialog.querySelectorAll('[data-reticle-preset]')) {
    button.addEventListener('click',()=>save(presets[button.dataset.reticlePreset]));
  }
  field('Reset').addEventListener('click',()=>save(defaults));

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
