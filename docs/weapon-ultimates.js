export const ultimateKey = 'KeyQ';
export const scopeKey = 'KeyE';

const styles = {
  scatter:{label:'Дробовик',hint:'Широкий залп. Вблизи больше дробин попадает в одну цель.',color:0xffa564,range:82},
  sniper:{label:'Снайперское орудие',hint:'E включает оптику. Наведи корабль и нажми Q для точного выстрела.',color:0x8bffe3,range:213},
  laser:{label:'Лазер',hint:'Удерживай цель в луче, пока он работает. Луч прошивает несколько целей.',color:0xb195ff,range:170},
  cannon:{label:'Тяжёлая пушка',hint:'Один удар. Взрыв при попадании задевает ближайшие цели.',color:0xffcb67,range:159}
};

const fleet = [
  ['cannon','Бортовой гром',34,5.2], ['scatter','Двойной веер',5.8,9],
  ['scatter','Плазменная картечь',5.1,11], ['sniper','Сквозная черта',38,.20],
  ['cannon','Огненный молот',37,6.4], ['laser','Ионная дуга',4.1,1.20],
  ['scatter','Ледяная метель',5.5,11], ['laser','Белая вспышка',4.6,1.26],
  ['cannon','Бортовой залп',41,7.1], ['laser','Белый рассвет',4.6,1.40],
  ['cannon','Осадный удар',43,6.0], ['sniper','Игла сирены',44,.16],
  ['sniper','Криогенная игла',43,.25], ['cannon','Пепельное ядро',46,8.2],
  ['scatter','Ионный шквал',6.0,11], ['sniper','Обсидиановая нить',49,.12],
  ['laser','Призматический раскол',4.7,1.45], ['scatter','Хвост кометы',6.6,11]
];

export const ultimates = fleet.map(([kind,name,damage,trait])=>({...styles[kind],kind,name,damage,trait}));

export function traceHit(origin,ray,target,radius,range) {
  const distance = origin.z-target.z;
  if (distance <= 0 || distance > range) return null;
  const x = origin.x+ray.x*distance;
  const y = origin.y+ray.y*distance;
  return Math.hypot(x-target.x,y-target.y) <= radius ? {x,y,z:target.z,distance} : null;
}

export function scatterRays(pellets) {
  return Array.from({length:pellets},(_,index)=>{
    if (index === 0) return {x:0,y:0};
    const angle = index*2.399963;
    const width = Math.sqrt(index/(pellets-1));
    return {x:Math.cos(angle)*width*.147,y:Math.sin(angle)*width*.066};
  });
}
