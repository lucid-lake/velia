// The sun and moon directions in ECEF and the ECI → ECEF rotation, for the sky (src/core/sky.js, src/daylight.js).
// A port of @takram/three-atmosphere 0.19.1's src/celestialDirections.ts (MIT, Takram), on astronomy-engine (MIT) as it
// does: the same calls in the same order, so the numbers are identical. Why here: that library exports these only from
// its package root, whose build is its WebGL code (318 kB) plus three's WebGLRenderer; importing them from there put
// 0.74 MB of JS we never run into every first visit.
import { AstroTime, Body, GeoVector, KM_PER_AU, Pivot, Rotation_EQJ_EQD, SiderealTime } from 'astronomy-engine';
import { Matrix4, Vector3 } from 'three/webgpu';

const METER_TO_AU = 0.001 / KM_PER_AU;
const vectorScratch1 = new Vector3();
const matrixScratch1 = new Matrix4();
const matrixScratch2 = new Matrix4();

const toAstroTime = (value) => (value instanceof AstroTime ? value : new AstroTime(value instanceof Date ? value : new Date(value)));

function fromAstroRotationMatrix(matrix, result) {
  const [row0, row1, row2] = matrix.rot;
  return result.set(
    row0[0], row1[0], row2[0], 0,
    row0[1], row1[1], row2[1], 0,
    row0[2], row1[2], row2[2], 0,
    0, 0, 0, 1);
}

export function getECIToECEFRotationMatrix(date, result = new Matrix4()) {
  const time = toAstroTime(date);
  return fromAstroRotationMatrix(Pivot(Rotation_EQJ_EQD(time), 2, -15 * SiderealTime(time)), result);
}

function getDirectionECI(body, time, result, observerECEF) {
  const { x, y, z } = GeoVector(body, time, false);
  result.set(x, y, z);
  if (observerECEF != null) {
    const matrixECEFToECI = getECIToECEFRotationMatrix(time, matrixScratch2).transpose();
    result.sub(vectorScratch1.copy(observerECEF).applyMatrix4(matrixECEFToECI).multiplyScalar(METER_TO_AU));
  }
  return result.normalize();
}

export function getSunDirectionECEF(date, result = new Vector3(), observerECEF) {
  const time = toAstroTime(date);
  return getDirectionECI(Body.Sun, time, result, observerECEF).applyMatrix4(getECIToECEFRotationMatrix(time, matrixScratch1));
}

export function getMoonDirectionECEF(date, result = new Vector3(), observerECEF) {
  const time = toAstroTime(date);
  return getDirectionECI(Body.Moon, time, result, observerECEF).applyMatrix4(getECIToECEFRotationMatrix(time, matrixScratch1));
}
