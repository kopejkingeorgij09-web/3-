import {ships} from './campaign.js';
import {currentProgress,favorShip,tuneShip,tunePrice,resetCampaign,restoreCampaign} from './progress.js';

const get = id => document.getElementById(id);
const amount = value => Math.floor(value).toLocaleString('ru-RU');

const tuning = [
  {id:'engine',name:'Манёвровые двигатели',perk:'Выше скорость манёвра и быстрее отклик',color:'#92e7ff'},
  {id:'armor',name:'Обшивка корпуса',perk:'−4,5% к входящему урону за ступень',color:'#a5e8bb'},
  {id:'weapon',name:'Усилитель оружия',perk:'+6,5% к урону за ступень',color:'#ffc480'}
];

export function tunedCraft(craft,upgrades = {}) {
  const engine = upgrades.engine || 0;
  const armor = upgrades.armor || 0;
  const weapon = upgrades.weapon || 0;
  return {
    ...craft,
    speed:craft.speed*(1+.04*engine),
    response:craft.response*(1+.05*engine),
    armor:(craft.armor ?? 1)*(1-.045*armor),
    damage:craft.damage*(1+.065*weapon)
  };
}

export function garageUI({shipIndex,refresh,onNewCampaign}) {
  const mod = get('tuneDialog');
  const confirm = get('campaignChange');
  const profile = get('profileDialog');
  const rows = [...mod.querySelectorAll('[data-tune]')].map(row=>({
    id:row.dataset.tune, label:row.querySelector('strong'), note:row.querySelector('p'),
    bar:row.querySelector('progress'), counter:row.querySelector('span'), button:row.querySelector('button')
  }));
  let busy = false;
  let viewed = 0;
  let restore = false;

  function fillTuning(progress) {
    const tiers = progress.tuning?.[viewed] || {};
    const owned = progress.owned.includes(viewed);
    get('tuneTitle').textContent = '«'+ships[viewed].name+'»';
    get('tuneBalance').textContent = amount(progress.credits)+' очков';
    for (const row of rows) {
      const stage = tiers[row.id] || 0;
      const price = tunePrice(row.id,stage);
      row.bar.value = stage;
      row.counter.textContent = stage+' / 3';
      row.button.disabled = busy || !owned || stage>=3 || progress.credits+(progress.pending||0)<price;
      row.button.textContent = stage>=3 ? 'Максимум' : amount(price)+' ◇';
      row.button.setAttribute('aria-label',stage>=3 ? row.label.textContent+' улучшены' :
        row.label.textContent+' · ступень '+(stage+1)+' за '+amount(price)+' очков');
    }
  }

  function update(index,progress) {
    const owned = progress.owned.includes(index);
    const starred = progress.favorite === index;
    get('shipTuning').hidden = get('favoriteShip').hidden = !owned;
    get('shipTuning').disabled = get('favoriteShip').disabled = busy;
    get('favoriteShip').setAttribute('aria-pressed',String(starred));
    get('favoriteShip').textContent = starred ? '★ Избранный' : '☆ В избранное';
    get('restoreCampaign').hidden = !progress.hasArchive;
    if (mod.open) fillTuning(progress);
  }

  async function perform(action,feedback,onSuccess,errorText) {
    if (busy) return;
    busy = true;
    refresh();
    feedback.textContent = 'Сохраняем…';
    get('applyCampaignChange').disabled = true;
    try {
      if (await action()) {
        feedback.textContent = '';
        onSuccess();
      } else feedback.textContent = errorText;
    } catch (error) {
      feedback.textContent = error.message || errorText;
    } finally {
      busy = false;
      get('applyCampaignChange').disabled = false;
      refresh();
    }
  }

  for (const row of rows) {
    const item = tuning.find(item=>item.id===row.id);
    row.label.textContent = item.name;
    row.note.textContent = item.perk;
    row.bar.style.setProperty('--upgrade-color',item.color);
    row.button.addEventListener('click',()=>perform(
      ()=>tuneShip(viewed,row.id),get('tuneNote'),
      ()=>{get('tuneNote').textContent='Улучшение установлено.';},
      'Улучшение не куплено. Проверь баланс и связь.'
    ));
  }

  get('shipTuning').addEventListener('click',()=>{
    viewed = shipIndex();
    get('tuneNote').textContent = '';
    fillTuning(currentProgress());
    mod.showModal();
  });
  get('favoriteShip').addEventListener('click',()=>{
    const index = shipIndex();
    const favorite = currentProgress().favorite === index ? null : index;
    perform(()=>favorShip(favorite),get('garageNotice'),()=>{
      get('garageNotice').textContent = favorite === null ? 'Избранный корабль снят.' : 'Избранный будет выбран при входе в ангар.';
    },'Изменение не сохранено. Проверь связь.');
  });

  function openCampaignChange(isRestore) {
    if (busy) return;
    restore = isRestore;
    get('campaignChangeTitle').textContent = restore ? 'Вернуть кампанию из архива?' : 'Начать кампанию с нуля?';
    get('campaignChangeCopy').textContent = restore
      ? 'Архив станет активным. Текущие вылеты, очки, корабли и тюнинг займут его место в архиве.'
      : 'Откроется первый вылет на «Стриже». Текущие вылеты, очки, корабли и тюнинг сохранятся в архиве.';
    get('campaignChangeNote').textContent = '';
    get('applyCampaignChange').textContent = restore ? 'Восстановить' : 'Начать с нуля';
    profile.close();
    confirm.showModal();
  }

  get('resetCampaign').addEventListener('click',()=>openCampaignChange(false));
  get('restoreCampaign').addEventListener('click',()=>openCampaignChange(true));
  get('applyCampaignChange').addEventListener('click',()=>{
    perform(restore ? restoreCampaign : resetCampaign,get('campaignChangeNote'),()=>{
      onNewCampaign();
      confirm.close();
      get('garageNotice').textContent = restore ? 'Кампания восстановлена из архива.' : 'Открыт первый вылет новой кампании.';
    },'Не удалось сменить кампанию. Проверь связь и повтори.');
  });
  confirm.addEventListener('cancel',event=>{if (busy) event.preventDefault();});
  confirm.querySelector('form').addEventListener('submit',event=>{if (busy) event.preventDefault();});

  return {update,get busy(){return busy;}};
}
