export const precisionKey = 'KeyC';
export const defaultSensitivity = 100;

export function normalizeSensitivity(value) {
  const number = Number(value);
  return value != null && Number.isFinite(number)
    ? Math.min(120,Math.max(70,Math.round(number/5)*5)) : defaultSensitivity;
}

export function steeringRates(craft) {
  const speed = Math.max(0,craft.speed-1);
  const response = Math.max(0,craft.response-1);
  const agility = 1+speed/(1+speed*.84);
  return {
    lateral:14*agility,
    vertical:11.8*agility,
    response:1+response*.48/(1+response*.52)
  };
}

export function steer(ship,axes,dt,rangeX,rangeY) {
  ship.previousX = ship.x;
  ship.previousY = ship.y;
  const length = Math.max(1,Math.hypot(axes.x,axes.y));
  const horizontal = axes.x/length;
  const vertical = axes.y/length;
  if (!horizontal || Math.sign(horizontal) !== ship.controlX) ship.holdX = 0;
  if (!vertical || Math.sign(vertical) !== ship.controlY) ship.holdY = 0;
  ship.controlX = Math.sign(horizontal);
  ship.controlY = Math.sign(vertical);

  function authority(held) {
    if (axes.analog) return 1;
    const phase = Math.min(1,(held+dt*.5)/.26);
    return .26+.74*phase*(2-phase);
  }
  const rate = axes.sensitivity*.01*(axes.precision ? .37 : 1);
  const targetX = horizontal*ship.steering.lateral*rate*authority(ship.holdX);
  const targetY = vertical*ship.steering.vertical*rate*authority(ship.holdY);
  ship.holdX = horizontal ? Math.min(.26,ship.holdX+dt) : 0;
  ship.holdY = vertical ? Math.min(.26,ship.holdY+dt) : 0;

  function axis(position,velocity,target,limit) {
    const braking = target === 0 || target*velocity < 0 || Math.abs(target) < Math.abs(velocity);
    const time = (axes.precision ? .030 : braking ? .038 : .066)/ship.steering.response;
    const decay = Math.exp(-dt/time);
    const next = position+target*dt+(velocity-target)*time*(1-decay);
    if (next <= -limit || next >= limit) return [Math.min(limit,Math.max(-limit,next)),0];
    return [next,target+(velocity-target)*decay];
  }
  [ship.x,ship.dx] = axis(ship.x,ship.dx,targetX,rangeX);
  [ship.y,ship.dy] = axis(ship.y,ship.dy,targetY,rangeY);
}

export function sweptDistance(ship,item,startZ,endZ,heightRatio) {
  const advance = item.z-item.previousZ;
  if (advance <= 0 || item.z < startZ || item.previousZ > endZ) return Infinity;
  const low = Math.max(0,(startZ-item.previousZ)/advance);
  const high = Math.min(1,(endZ-item.previousZ)/advance);
  const x = item.previousX-ship.previousX;
  const y = (item.previousY-ship.previousY)*heightRatio;
  const dx = item.x-ship.x-x;
  const dy = (item.y-ship.y)*heightRatio-y;
  const motion = dx*dx+dy*dy;
  const fraction = motion ? Math.min(high,Math.max(low,-(x*dx+y*dy)/motion)) : low;
  return Math.hypot(x+dx*fraction,y+dy*fraction);
}
