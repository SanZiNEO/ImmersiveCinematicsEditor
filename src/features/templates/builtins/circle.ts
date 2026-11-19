/**
 * 水平圆轨道几何（与 core/paths/generators.ts 同一数学模型）。
 *
 * 法向 normal=(0,1,0)，参考轴 reference=(1,0,0)：
 * 基向量 u=(1,0,0)，v=cross(normal,u)=(0,0,-1)。
 * 点 p(θ)=(cx+r·cosθ, cy+height, cz−r·sinθ)；切向 t(θ)=(−r·sinθ, 0, −r·cosθ)。
 * 贝塞尔控制点系数 α=(4/3)·tan(Δ/4)，c1=p0+α·t0，c2=p3−α·t1（相对段起点）。
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

const DEG = Math.PI / 180

/** 水平圆上角度 θ（度）对应的世界坐标。 */
export function circlePoint(center: Vec3, radius: number, height: number, angleDeg: number): Vec3 {
  const theta = angleDeg * DEG
  return {
    x: center.x + radius * Math.cos(theta),
    y: center.y + height,
    z: center.z - radius * Math.sin(theta),
  }
}

/** 水平圆上角度 θ（度）处的切向（已乘半径；参数导数方向）。 */
export function circleTangent(radius: number, angleDeg: number): Vec3 {
  const theta = angleDeg * DEG
  return {
    x: -radius * Math.sin(theta),
    y: 0,
    z: -radius * Math.cos(theta),
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function multiply(a: Vec3, scalar: number): Vec3 {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar }
}

/**
 * 两段控制点（相对段起点 p0 的完整偏移对象 {dx,dy,dz}）。
 * `deltaDeg` 为有向扫角（度）；α 随有向角取号，与生成器一致。
 */
export function bezierRelativeControls(
  p0: Vec3,
  p3: Vec3,
  t0: Vec3,
  t1: Vec3,
  deltaDeg: number,
): [Vec3, Vec3] {
  const alpha = (4 / 3) * Math.tan((deltaDeg * DEG) / 4)
  const c1 = add(p0, multiply(t0, alpha))
  const c2 = subtract(p3, multiply(t1, alpha))
  return [subtract(c1, p0), subtract(c2, p0)]
}
