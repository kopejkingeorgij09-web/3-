export const aceWeapons = {
  needle:{name:'Игольник',kind:'needle',speed:87,damage:14,lead:.22,spread:[[0,0]],scale:.76},
  fan:{name:'Плазменный веер',kind:'fan',speed:57,damage:15,lead:0,spread:[[-6.1,0],[-3.05,.4],[0,0],[3.05,.4],[6.1,0]],scale:.85},
  plasma:{name:'Осадная плазма',kind:'plasma',speed:47,damage:24,lead:.12,spread:[[-1.7,0],[1.7,0]],scale:1.30},
  ion:{name:'Ионная очередь',kind:'ion',speed:67,damage:13,lead:.08,drain:11,spread:[[-2.85,1.9],[0,0],[2.85,-1.9]],scale:.91},
  mines:{name:'Дрейфующие мины',kind:'mines',speed:36,damage:21,lead:0,spread:[[-2.6,1],[2.6,-1.1]],scale:1.04}
};

export const aceUltimates = {
  spear:{name:'Звёздное копьё',hint:'Уйди вбок от тонкой метки. Выстрел бьёт по зафиксированной линии.',windup:1.15,radius:[1.9,1.55],color:0xffcc7a},
  storm:{name:'Штормовой залп',hint:'Выйди из отмеченной полосы. Веер перекрывает несколько соседних курсов.',windup:1.35,radius:[6.8,2.25],color:0xff7eaa},
  field:{name:'Минное созвездие',hint:'Уйди выше или ниже ловушки. Мины приходят двумя волнами.',windup:1.48,radius:[5.9,2.3],color:0xff9264},
  pulse:{name:'Кольцо разлома',hint:'Разряды расширяют зону атаки. Сдвинься на другой фланг или включи форсаж.',windup:1.39,radius:[5.5,3.0],color:0xb992ff},
  collapse:{name:'Коллапс',hint:'Горизонтальный и вертикальный залпы идут один за другим. Уходи по диагонали.',windup:1.42,radius:[6.1,3.4],color:0x85eaff}
};

const chapters = [
  {region:'Край тени',tint:0x626ada,orbit:8},
  {region:'Полное затмение',tint:0xb16df2,orbit:14},
  {region:'Огненная корона',tint:0xff995f,orbit:21}
];

const ranks = [
  ['Сумрак','scout','needle','spear','weave',42,3.10,10.8],
  ['Сполох','gunner','fan','storm','weave',46,3.00,10.9],
  ['Картограф','trapper','mines','field','vertical',51,3.00,11.0],
  ['Мираж','scout','ion','pulse','rush',55,2.86,11.1],
  ['Гранит','bulwark','plasma','collapse','heavy',60,2.92,11.4],
  ['Игла','scout','needle','pulse','vertical',65,2.80,11.0],
  ['Веспер','gunner','fan','spear','rush',69,2.72,11.3],
  ['Кассини','trapper','mines','collapse','weave',73,2.65,11.2],
  ['Спектр','scout','ion','field','rush',77,2.58,11.5],
  ['Свинцовое небо','bulwark','plasma','storm','heavy',83,2.62,11.9],
  ['Арктур','gunner','needle','collapse','rush',86,2.48,11.8],
  ['Вихрь','scout','fan','pulse','vertical',89,2.38,12.0],
  ['Цербер','trapper','mines','storm','rush',93,2.32,12.2],
  ['Перигелий','bulwark','plasma','spear','weave',99,2.34,12.4],
  ['Затменный ас','gunner','ion','collapse','eclipse',106,2.21,12.8],
  ['Клин', 'scout', 'needle', 'field', 'rush', 105.0, 2.34, 12.8],
  ['Пепельный ветер', 'gunner', 'fan', 'collapse', 'weave', 107.7, 2.328, 12.818000000000001],
  ['Геката', 'trapper', 'mines', 'pulse', 'vertical', 110.4, 2.316, 12.836],
  ['Гало', 'bulwark', 'plasma', 'storm', 'heavy', 113.1, 2.304, 12.854000000000001],
  ['Меридиан', 'gunner', 'ion', 'spear', 'eclipse', 115.8, 2.292, 12.872],
  ['Полюс', 'scout', 'needle', 'collapse', 'rush', 118.5, 2.28, 12.89],
  ['Шип', 'gunner', 'fan', 'pulse', 'weave', 121.2, 2.268, 12.908000000000001],
  ['Рубеж', 'trapper', 'mines', 'storm', 'vertical', 123.9, 2.256, 12.926],
  ['Красная дуга', 'bulwark', 'plasma', 'spear', 'heavy', 126.6, 2.2439999999999998, 12.944],
  ['Антарес', 'gunner', 'ion', 'field', 'eclipse', 129.3, 2.2319999999999998, 12.962000000000002],
  ['Дельта', 'scout', 'needle', 'pulse', 'rush', 132.0, 2.2199999999999998, 12.98],
  ['Часовой', 'gunner', 'fan', 'storm', 'weave', 134.7, 2.2079999999999997, 12.998000000000001],
  ['Разлом', 'trapper', 'mines', 'spear', 'vertical', 137.4, 2.1959999999999997, 13.016],
  ['Фата-моргана', 'bulwark', 'plasma', 'field', 'heavy', 140.1, 2.1839999999999997, 13.034],
  ['Чёрное Солнце', 'gunner', 'ion', 'collapse', 'eclipse', 142.8, 2.1719999999999997, 13.052000000000001]
];

export const duelStages = ranks.map(([name,variant,weapon,ultimate,flight,health,interval,charge],index)=>({
  ...chapters[Math.floor(index/10)],name,variant,weapon,ultimate,flight,health,interval,charge,
  difficulty:Math.floor(index*.39),chapter:Math.floor(index/10),index
}));

const campaignAces = {
  6:[3,0],9:[5,1],12:[7,2],15:[8,1],18:[10,0],21:[12,2],23:[14,1]
};

export function campaignAce(level,sector) {
  const slot = campaignAces[level];
  return slot?.[1] === sector ? duelStages[slot[0]] : null;
}

export const duelCredit = index => 200+index*25;

export function tandemWaves(stage) {
  const i = stage.index;
  if (i < 5) return [[stage]];
  const escort = {...duelStages[(i*3+2)%i],health:24+Math.round(i*.9),interval:3.0,charge:8};
  if (i < 10) return [[escort],[stage]];
  const wing = {...duelStages[(i*3+3)%i],health:22+Math.round(i*.72),interval:3.55,charge:7.2};
  const boss = {...stage,health:Math.round(stage.health*1.16),boss:true};
  return i < 20 ? [[escort,wing],[boss]] :
    [[escort,wing],[{...stage,health:45,charge:9.5},{...wing,health:34}],[boss]];
}

export function duelWaves(stage) {
  const i = stage.index;
  const escort = (offset,weight)=>{
    const ally = duelStages[(i*3+offset)%i];
    return {...ally,health:Math.round((36+i*2.25)*weight),interval:Math.max(1.95,3.1-i*.039),charge:9+i*.20};
  };
  const leader = {...stage,health:Math.round(stage.health*1.23),interval:stage.interval*.87,charge:stage.charge*1.23};
  if (i<3) return [[leader]];
  if (i<10) return [[escort(2,1)],[leader]];
  if (i<20) return [[escort(2,.94),escort(3,.88)],[leader]];
  return [[escort(2,.97),escort(3,.90)],[escort(5,1.03),escort(6,.97)],[leader,escort(8,1.08)]];
}

export function duelBoss(stage) {
  const i = stage.index;
  return {
    name: ['Страж тени','Страж затмения','Страж короны'][stage.chapter],
    hp: 68+Math.round(i*4.9),
    shield: i >= 2,
    turret: i >= 5,
    tint: [0x95a7ff,0xfa89f1,0xffa465][stage.chapter],
    special: aceUltimates[stage.ultimate],
    secondary: ['fan','mines','ion'][stage.chapter],
    interval: 2.52-i*.032,
    enrage: i>=4 ? .51 : .43
  };
}
