export const ships = [
  {name:'Стриж', weapon:'Импульсная пушка', detail:'Прямой импульс, точный на любой дистанции.', unlock:1, speed:1, response:1, color:0xc09bff, hull:0xa4a7c8, cooldown:.185, damage:2, pattern:[0]},
  {name:'Сапсан', weapon:'Спаренные бластеры', detail:'Два параллельных залпа перекрывают больше пространства.', unlock:2, speed:1.14, response:1.18, color:0x64e7ff, hull:0x93bdd7, cooldown:.235, damage:1.4, pattern:[-.65,.65]},
  {name:'Мантикора', weapon:'Плазменный веер', detail:'Три расходящихся заряда. Особенно мощный вблизи.', unlock:4, speed:1.26, response:1.3, color:0xffa066, hull:0xcb8e82, cooldown:.285, damage:1.45, pattern:[-.48,0,.48], spread:5},
  {name:'Фантом', weapon:'Рельсотрон', detail:'Быстрый снаряд прошивает мины и скалы насквозь.', unlock:6, speed:1.38, response:1.46, color:0xc6ff73, hull:0x93b089, cooldown:.31, damage:4.5, pattern:[0], pierce:true, velocity:177},
  {name:'Зенит', weapon:'Самонаводящиеся ракеты', detail:'Две ракеты доворачивают к ближайшей цели на курсе.', unlock:9, speed:1.53, response:1.63, color:0xff85e1, hull:0xd69bc7, cooldown:.305, damage:2.4, pattern:[-.68,.68], guided:true, velocity:88}
];

export const levels = [
  {name:'Штормовое ядро', route:['Обломки','Вихревой пояс','Сердце шторма'], tint:[0xa875ff,0x60d3ff,0xf08bfc]},
  {name:'Ледяная орбита', route:['Ледяной шлейф','Холодный разлом','Синий гигант'], tint:[0x64c9ff,0x68f0e1,0x497bff]},
  {name:'Красный пояс', route:['Пепельная дуга','Магма','Алый горизонт'], tint:[0xffa767,0xfa4b7e,0xff6374]},
  {name:'Тень Сатурна', route:['Кольца','Теневая сторона','Дробление'], tint:[0xc796ef,0xe9b888,0xee79cc]},
  {name:'Мёртвый маяк', route:['Помехи','Обрыв сигнала','Последний огонь'], tint:[0x8defcb,0x61e678,0xeea458]},
  {name:'Стеклянная буря', route:['Осколочный фронт','Призма','Зеркальная пасть'], tint:[0x78eaff,0xdab7ff,0x5a81fa]},
  {name:'Кузница комет', route:['След кометы','Двойной хвост','Жар ядра'], tint:[0xffd17c,0xf97853,0xe4427a]},
  {name:'Предел скорости', route:['Разбег','Критическая орбита','Гравитационный срыв'], tint:[0x71f4f4,0x6792ff,0xe078ff]},
  {name:'Чёрное солнце', route:['Полутень','Затмение','Вспышка'], tint:[0xaf75ed,0xff725f,0xeb50b0]},
  {name:'Охота на Стражей', route:['Патруль','Перехват','Кольцо блокады'], tint:[0x8ffabc,0x54d1ff,0xff538b]},
  {name:'Нулевая орбита', route:['Край системы','Сингулярность','Нулевая отметка'], tint:[0x819fff,0xb873ff,0xf8a960]},
  {name:'Последний разлом', route:['Раскол','Эпицентр','За гранью шторма'], tint:[0xff6cad,0x8751ff,0xffb28f]}
];

export const captureZ = -1.85;
export const captureHeightRatio = 1.14;
export const captureRadius = scale => 1.43 * scale + .49;

export function captureTest(ship,crystal) {
  if (crystal.previousZ > captureZ || crystal.z <= captureZ) return false;
  const progress = (captureZ-crystal.previousZ)/(crystal.z-crystal.previousZ);
  const x = (crystal.previousX-ship.previousX)*(1-progress)+(crystal.x-ship.x)*progress;
  const y = (crystal.previousY-ship.previousY)*(1-progress)+(crystal.y-ship.y)*progress;
  return Math.hypot(x,y*captureHeightRatio) <= captureRadius(crystal.scale);
}
