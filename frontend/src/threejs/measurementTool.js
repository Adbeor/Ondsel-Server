// SPDX-FileCopyrightText: 2024 Ondsel <development@ondsel.com>
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three';

export const COLOR_ITEM1 = 0x00b4d8; // Technical CAD Cyan (crisp, pleasant, non-glare)
export const COLOR_ITEM2 = 0xf59e0b; // Precision Amber
export const COLOR_ACCENT = 0xeab308; // Technical Gold
export const COLOR_DIMENSION_LIGHT = 0x111827; // Deep dark charcoal / black for light theme cotas
export const COLOR_DIMENSION_DARK = 0xffffff;  // Crisp pure white for dark theme cotas

/**
 * Distance from point P to line segment A -> B.
 */
export function distancePointToSegment(P, A, B, outClosest = null) {
  const AB = new THREE.Vector3().subVectors(B, A);
  const AP = new THREE.Vector3().subVectors(P, A);
  const abLenSq = AB.lengthSq();
  if (abLenSq < 1e-8) {
    if (outClosest) outClosest.copy(A);
    return P.distanceTo(A);
  }
  let t = AP.dot(AB) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const closest = new THREE.Vector3().copy(A).addScaledVector(AB, t);
  if (outClosest) outClosest.copy(closest);
  return P.distanceTo(closest);
}

/**
 * Fast cached topology for contiguous CAD face extraction on meshes
 */
export function getMeshTopology(mesh) {
  if (mesh.userData._cadFaceTopology) {
    return mesh.userData._cadFaceTopology;
  }

  const geometry = mesh.geometry;
  if (!geometry || !geometry.attributes.position) return null;

  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = index ? index.count / 3 : pos.count / 3;

  if (triCount === 0) return null;

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(pos);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1.0);
  const quant = Math.max(1e-4, maxDim * 1e-4);
  const invQuant = 1.0 / quant;

  const getVertexKey = (x, y, z) => {
    return `${Math.round(x * invQuant)}_${Math.round(y * invQuant)}_${Math.round(z * invQuant)}`;
  };

  const triangles = new Array(triCount);
  const edgeToTriangles = new Map();
  const vKeyToPos = new Map();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const ia = index ? index.getX(i * 3) : i * 3;
    const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;

    vA.fromBufferAttribute(pos, ia);
    vB.fromBufferAttribute(pos, ib);
    vC.fromBufferAttribute(pos, ic);

    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    const normal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const d = normal.dot(vA);

    const ka = getVertexKey(vA.x, vA.y, vA.z);
    const kb = getVertexKey(vB.x, vB.y, vB.z);
    const kc = getVertexKey(vC.x, vC.y, vC.z);

    if (!vKeyToPos.has(ka)) vKeyToPos.set(ka, vA.clone());
    if (!vKeyToPos.has(kb)) vKeyToPos.set(kb, vB.clone());
    if (!vKeyToPos.has(kc)) vKeyToPos.set(kc, vC.clone());

    const eAB = ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
    const eBC = kb < kc ? `${kb}#${kc}` : `${kc}#${kb}`;
    const eCA = kc < ka ? `${kc}#${ka}` : `${ka}#${kc}`;

    triangles[i] = {
      index: i,
      indices: [ia, ib, ic],
      vKeys: [ka, kb, kc],
      normal,
      d,
      edges: [eAB, eBC, eCA]
    };

    for (const ek of [eAB, eBC, eCA]) {
      let list = edgeToTriangles.get(ek);
      if (!list) {
        list = [];
        edgeToTriangles.set(ek, list);
      }
      list.push(i);
    }
  }

  // Precompute crease / feature edge graph (for instant circular rim & arista tracing)
  const creaseAdjacency = new Map();
  const creaseEdgeSet = new Set();

  for (const [ek, tris] of edgeToTriangles.entries()) {
    let isCrease = false;
    if (tris.length === 1) {
      isCrease = true; // Open boundary edge
    } else if (tris.length === 2) {
      const n1 = triangles[tris[0]].normal;
      const n2 = triangles[tris[1]].normal;
      if (n1.dot(n2) < 0.985) {
        isCrease = true; // Sharp crease edge (e.g. hole rim, arista or cylinder shoulder)
      }
    }

    if (isCrease) {
      creaseEdgeSet.add(ek);
      const [ka, kb] = ek.split('#');
      if (!creaseAdjacency.has(ka)) creaseAdjacency.set(ka, []);
      if (!creaseAdjacency.has(kb)) creaseAdjacency.set(kb, []);
      creaseAdjacency.get(ka).push({ nbrKey: kb, edgeKey: ek });
      creaseAdjacency.get(kb).push({ nbrKey: ka, edgeKey: ek });
    }
  }

  const topology = {
    triangles,
    edgeToTriangles,
    vKeyToPos,
    creaseAdjacency,
    creaseEdgeSet,
    pos,
    quant,
    maxDim
  };

  mesh.userData._cadFaceTopology = topology;
  return topology;
}

/**
 * Extracts the exact contiguous planar CAD face containing the hit triangle
 */
export function extractCADPlanarFace(mesh, seedTriangleIndex, hitPoint, cameraRayDirection = null) {
  if (!mesh || !mesh.geometry) return null;
  const topology = getMeshTopology(mesh);
  if (!topology) return null;

  const { triangles, edgeToTriangles, pos, quant } = topology;
  if (seedTriangleIndex < 0 || seedTriangleIndex >= triangles.length) return null;

  const seedTri = triangles[seedTriangleIndex];
  const seedNormalLocal = seedTri.normal;
  const seedD = seedTri.d;

  // Breadth-First Search for contiguous coplanar triangles
  const queue = [seedTriangleIndex];
  const visited = new Set([seedTriangleIndex]);
  const faceTriangles = [seedTri];

  // Coplanar tolerances:
  // Normal alignment: dot product >= 0.998 (~3.6 deg)
  // Distance of vertices to seed plane: |normal · v - d| <= distTol
  const distTol = Math.max(0.015, quant * 4.0);
  const maxTriangles = 30000;

  const ptA = new THREE.Vector3();
  const ptB = new THREE.Vector3();
  const ptC = new THREE.Vector3();

  while (queue.length > 0 && faceTriangles.length < maxTriangles) {
    const curIdx = queue.shift();
    const curTri = triangles[curIdx];

    for (const edgeKey of curTri.edges) {
      const neighbors = edgeToTriangles.get(edgeKey);
      if (!neighbors) continue;

      for (const nbrIdx of neighbors) {
        if (visited.has(nbrIdx)) continue;

        const nbrTri = triangles[nbrIdx];

        // Check normal alignment
        if (nbrTri.normal.dot(seedNormalLocal) < 0.998) continue;

        // Check distance of vertices to seed plane
        const [ia, ib, ic] = nbrTri.indices;
        ptA.fromBufferAttribute(pos, ia);
        ptB.fromBufferAttribute(pos, ib);
        ptC.fromBufferAttribute(pos, ic);

        if (Math.abs(seedNormalLocal.dot(ptA) - seedD) > distTol) continue;
        if (Math.abs(seedNormalLocal.dot(ptB) - seedD) > distTol) continue;
        if (Math.abs(seedNormalLocal.dot(ptC) - seedD) > distTol) continue;

        visited.add(nbrIdx);
        faceTriangles.push(nbrTri);
        queue.push(nbrIdx);
      }
    }
  }

  // Calculate world normal
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  let worldNormal = seedNormalLocal.clone().applyMatrix3(normalMatrix).normalize();
  if (cameraRayDirection && cameraRayDirection.dot(worldNormal) > 0) {
    worldNormal.negate();
  }

  // Extract outer and inner boundary perimeter edges
  const edgeCounts = new Map();
  const edgeVertexWorld = new Map();

  for (const tri of faceTriangles) {
    for (let k = 0; k < 3; k++) {
      const ek = tri.edges[k];
      edgeCounts.set(ek, (edgeCounts.get(ek) || 0) + 1);

      if (!edgeVertexWorld.has(ek)) {
        const ia = tri.indices[k];
        const ib = tri.indices[(k + 1) % 3];
        const wA = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
        const wB = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
        edgeVertexWorld.set(ek, [wA, wB]);
      }
    }
  }

  const boundarySegments = [];
  for (const [ek, count] of edgeCounts.entries()) {
    if (count === 1) {
      const [wA, wB] = edgeVertexWorld.get(ek);
      boundarySegments.push(wA, wB);
    }
  }

  // Build world position buffer geometry for face triangles
  const vertexPositions = new Float32Array(faceTriangles.length * 9);
  let vOffset = 0;
  const tempW = new THREE.Vector3();

  for (const tri of faceTriangles) {
    for (let k = 0; k < 3; k++) {
      tempW.fromBufferAttribute(pos, tri.indices[k]).applyMatrix4(mesh.matrixWorld);
      vertexPositions[vOffset++] = tempW.x;
      vertexPositions[vOffset++] = tempW.y;
      vertexPositions[vOffset++] = tempW.z;
    }
  }

  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute('position', new THREE.BufferAttribute(vertexPositions, 3));
  faceGeometry.computeVertexNormals();

  let boundaryGeometry = null;
  if (boundarySegments.length > 0) {
    boundaryGeometry = new THREE.BufferGeometry().setFromPoints(boundarySegments);
  }

  // Collect sample points (boundary + surface) for partial cut visibility testing
  const samplePoints = [];
  if (hitPoint) {
    samplePoints.push(hitPoint.clone());
  }

  // 1. Boundary perimeter samples
  const bCount = boundarySegments.length;
  if (bCount > 0) {
    const bStep = Math.max(1, Math.floor(bCount / 120));
    for (let i = 0; i < bCount; i += bStep) {
      samplePoints.push(boundarySegments[i].clone());
    }
  }

  // 2. Surface / interior samples from triangles
  const tCount = faceTriangles.length;
  if (tCount > 0) {
    const tStep = Math.max(1, Math.floor(tCount / 80));
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    for (let i = 0; i < tCount; i += tStep) {
      const tri = faceTriangles[i];
      vA.fromBufferAttribute(pos, tri.indices[0]).applyMatrix4(mesh.matrixWorld);
      vB.fromBufferAttribute(pos, tri.indices[1]).applyMatrix4(mesh.matrixWorld);
      vC.fromBufferAttribute(pos, tri.indices[2]).applyMatrix4(mesh.matrixWorld);
      const centroid = new THREE.Vector3().add(vA).add(vB).add(vC).multiplyScalar(1 / 3);
      samplePoints.push(centroid);
    }
  }

  return {
    mesh,
    seedTriangleIndex,
    trianglesCount: faceTriangles.length,
    triangleIndicesSet: visited,
    normal: worldNormal,
    faceGeometry,
    boundaryGeometry,
    boundarySegments,
    samplePoints,
    hitPoint: hitPoint.clone()
  };
}

/**
 * Evaluates whether a CAD planar face has any visible portion remaining on screen under section plane.
 * Returns true if at least one sample point has distance >= -0.005.
 * Returns false only if every single sample point is in the cut-away half-space.
 */
export function isFaceVisibleUnderPlane(faceData, plane) {
  if (!faceData || !plane) return true;
  const samples = faceData.samplePoints;
  if (samples && samples.length > 0) {
    for (let i = 0; i < samples.length; i++) {
      if (plane.distanceToPoint(samples[i]) >= -0.005) {
        return true;
      }
    }
    return false;
  }
  if (faceData.hitPoint) {
    return plane.distanceToPoint(faceData.hitPoint) >= -0.005;
  }
  return true;
}

/**
 * Evaluates whether a CAD straight edge has any visible portion remaining under section plane.
 */
export function isEdgeVisibleUnderPlane(edgeData, plane) {
  if (!edgeData || !plane) return true;
  if (edgeData.p1 && plane.distanceToPoint(edgeData.p1) >= -0.005) return true;
  if (edgeData.p2 && plane.distanceToPoint(edgeData.p2) >= -0.005) return true;
  if (edgeData.midpoint && plane.distanceToPoint(edgeData.midpoint) >= -0.005) return true;
  return false;
}

/**
 * Evaluates whether a CAD cylinder or hole has any visible portion remaining under section plane.
 */
export function isCylinderVisibleUnderPlane(cylData, plane) {
  if (!cylData || !plane) return true;
  if (cylData.isCutCircle) return true;
  const pts = [
    cylData.topCenter,
    cylData.bottomCenter,
    cylData.rimCenter,
    cylData.otherRimCenter,
    cylData.center,
    cylData.hitPoint
  ].filter(Boolean);
  for (let i = 0; i < pts.length; i++) {
    if (plane.distanceToPoint(pts[i]) >= -0.005) return true;
  }
  // Check if section plane intersects the axis between bottom and top
  if (cylData.bottomCenter && cylData.topCenter && cylData.axis) {
    const d1 = plane.distanceToPoint(cylData.bottomCenter);
    const d2 = plane.distanceToPoint(cylData.topCenter);
    if ((d1 >= -0.005 && d2 < -0.005) || (d1 < -0.005 && d2 >= -0.005)) return true;
  }
  return false;
}

/**
 * Finds optimal visible 3D anchor for badge/rings on a cylinder clipped by section plane.
 */
export function findVisibleCylinderAnchor(cylData, plane) {
  if (!cylData) return null;
  const defaultPt = cylData.topCenter || cylData.rimCenter || cylData.center || cylData.hitPoint;
  if (!plane) return defaultPt;

  // 1. If default point is visible, use it
  if (defaultPt && plane.distanceToPoint(defaultPt) >= -0.005) {
    return defaultPt;
  }

  // 2. If cylinder axis intersects section plane between bottom and top:
  if (cylData.axis && (cylData.topCenter || cylData.center)) {
    const P0 = cylData.center || cylData.topCenter;
    const denom = plane.normal.dot(cylData.axis);
    if (Math.abs(denom) > 1e-4) {
      const t = -(plane.normal.dot(P0) + plane.constant) / denom;
      const Pcut = P0.clone().addScaledVector(cylData.axis, t);
      const maxSpan = (cylData.depth > 0.05 ? cylData.depth * 0.6 : cylData.radius * 2);
      if (Pcut.distanceTo(P0) <= maxSpan * 1.5) {
        return Pcut;
      }
    }
  }

  // 3. If bottomCenter is visible, use it
  if (cylData.bottomCenter && plane.distanceToPoint(cylData.bottomCenter) >= -0.005) {
    return cylData.bottomCenter;
  }

  // 4. Fallback to hitPoint if visible
  if (cylData.hitPoint && plane.distanceToPoint(cylData.hitPoint) >= -0.005) {
    return cylData.hitPoint;
  }

  return defaultPt;
}

/**
 * 2D Algebraic Circle Fit (Kåsa / Pratt method)
 * Solves (u - uc)^2 + (v - vc)^2 = r^2 analytically from an array of 2D points {u, v}
 */
export function fitCircle2D(points) {
  const n = points.length;
  if (n < 3) return null;

  let sumU = 0;
  let sumV = 0;
  for (let i = 0; i < n; i++) {
    sumU += points[i].u;
    sumV += points[i].v;
  }
  const meanU = sumU / n;
  const meanV = sumV / n;

  let Mxx = 0, Myy = 0, Mxy = 0, Mxz = 0, Myz = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i].u - meanU;
    const y = points[i].v - meanV;
    const z = x * x + y * y;
    Mxx += x * x;
    Myy += y * y;
    Mxy += x * y;
    Mxz += x * z;
    Myz += y * z;
  }
  Mxx /= n;
  Myy /= n;
  Mxy /= n;
  Mxz /= n;
  Myz /= n;

  const det = Mxx * Myy - Mxy * Mxy;
  if (Math.abs(det) < 1e-12) return null;

  const xc = (Mxz * Myy - Myz * Mxy) / (2 * det);
  const yc = (Myz * Mxx - Mxz * Mxy) / (2 * det);
  const r = Math.sqrt(Math.max(1e-8, xc * xc + yc * yc + Mxx + Myy));
  const uc = meanU + xc;
  const vc = meanV + yc;

  // Compute standard deviation of residuals
  let sumResSq = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(points[i].u - uc, points[i].v - vc);
    sumResSq += (d - r) * (d - r);
  }
  const sigma = Math.sqrt(sumResSq / n);

  return {
    uc,
    vc,
    r,
    sigma,
    relError: sigma / r
  };
}

/**
 * Computes circumscribed circle passing through 3 points in 3D
 */
export function circumcenter3D(A, B, C) {
  const a = new THREE.Vector3().subVectors(B, A);
  const b = new THREE.Vector3().subVectors(C, A);
  const axb = new THREE.Vector3().crossVectors(a, b);
  const lenAxBSq = axb.lengthSq();
  if (lenAxBSq < 1e-10) return null;

  const term = new THREE.Vector3()
    .subVectors(
      new THREE.Vector3(b.x, b.y, b.z).multiplyScalar(a.lengthSq()),
      new THREE.Vector3(a.x, a.y, a.z).multiplyScalar(b.lengthSq())
    );
  const offset = new THREE.Vector3().crossVectors(term, axb).multiplyScalar(1 / (2 * lenAxBSq));
  const center = new THREE.Vector3(A.x, A.y, A.z).add(offset);
  const radius = center.distanceTo(A);
  const normal = axb.clone().normalize();
  const { U, V } = getOrthonormalBasis(normal);

  return {
    center,
    radius,
    diameter: radius * 2,
    normal,
    U,
    V
  };
}

/**
 * Cleanly formats a number, avoiding -0.0
 */
export function formatNum(n, decimals = 2) {
  if (Math.abs(n) < 1e-5) return (0).toFixed(decimals);
  return n.toFixed(decimals);
}

/**
 * Cleanly formats 3D vector coordinates, avoiding (-0.0, -0.0, 0.0)
 */
export function formatVec3(v, decimals = 1) {
  if (!v) return '(0.0, 0.0, 0.0)';
  const fx = formatNum(v.x, decimals);
  const fy = formatNum(v.y, decimals);
  const fz = formatNum(v.z, decimals);
  return `(${fx}, ${fy}, ${fz})`;
}

/**
 * Enforces a canonical, deterministic positive direction for cylindrical axes
 * Prioritizes +Z > +Y > +X to prevent sign flips between identical parts
 */
export function canonicalizeAxis(axis) {
  if (!axis) return axis;
  const eps = 1e-4;
  if (axis.z > eps) return axis;
  if (axis.z < -eps) return axis.negate();
  if (axis.y > eps) return axis;
  if (axis.y < -eps) return axis.negate();
  if (axis.x < -eps) return axis.negate();
  return axis;
}

/**
 * Computes an exact, robust orthonormal basis (U, V) perpendicular to normal N.
 * Guaranteed to never divide by zero or produce NaNs for any 3D vector.
 */
export function getOrthonormalBasis(normal) {
  const U = new THREE.Vector3();
  if (Math.abs(normal.z) < 0.9) {
    U.crossVectors(normal, new THREE.Vector3(0, 0, 1)).normalize();
  } else {
    U.crossVectors(normal, new THREE.Vector3(1, 0, 0)).normalize();
  }
  const V = new THREE.Vector3().crossVectors(normal, U).normalize();
  return { U, V };
}

/**
 * Creates a true 3D volumetric cylindrical rod between p1 and p2.
 * Clean, subtle CAD dimension lines.
 */
export function createThickLineMesh(p1, p2, radius = 0.85, colorHex = 0x00b4d8, depthTest = true, isDimension = false) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const length = dir.length();
  if (length < 1e-3) return new THREE.Group();

  const geom = new THREE.CylinderGeometry(radius, radius, length, 12, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    depthTest: depthTest,
    depthWrite: false, // Prevents z-fighting and self-occlusion with coplanar CAD faces
    polygonOffset: true,
    polygonOffsetFactor: isDimension ? -5 : -3,
    polygonOffsetUnits: isDimension ? -5 : -3
  });
  const mesh = new THREE.Mesh(geom, mat);
  const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  mesh.position.copy(midpoint);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  mesh.renderOrder = isDimension ? 3025 : 3020;
  if (isDimension) {
    mesh.userData.isDimensionLine = true;
  }
  return mesh;
}

/**
 * Calculates adaptive ring ribbon half-width proportional to radius.
 * Proportional thickness: ~2.0% of radius.
 * Solid floor (0.08 mm) so tiny holes remain crisp and visible.
 * Clean ceiling (2.5 mm) so large cylinders don't become disproportionate.
 */
export function getAdaptiveRingHalfWidth(radius, isHover = false) {
  const prop = radius * 0.02;
  const halfW = Math.max(0.08, Math.min(2.5, prop));
  return isHover ? halfW * 0.85 : halfW;
}

/**
 * Creates a smooth 3D ribbon ring (annular band) along a circle with adaptive physical width.
 * Clean, discrete circular rims that never vanish into coplanar surfaces.
 */
export function createThickRingMesh(centerPt, U, V, radius, halfWidth = null, colorHex = 0x00b4d8, isHover = false, renderOrder = 3018, depthTest = true) {
  if (halfWidth === null || halfWidth === undefined) {
    halfWidth = getAdaptiveRingHalfWidth(radius, isHover);
  }
  // Ensure ring never covers more than 25% of radius (prevents inner hole collapse)
  halfWidth = Math.min(halfWidth, radius * 0.25);

  const segments = 64;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices = [];

  const rInner = Math.max(radius * 0.05, radius - halfWidth);
  const rOuter = radius + halfWidth;

  let vOffset = 0;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const pIn = centerPt.clone()
      .addScaledVector(U, rInner * cos)
      .addScaledVector(V, rInner * sin);
    positions[vOffset++] = pIn.x;
    positions[vOffset++] = pIn.y;
    positions[vOffset++] = pIn.z;

    const pOut = centerPt.clone()
      .addScaledVector(U, rOuter * cos)
      .addScaledVector(V, rOuter * sin);
    positions[vOffset++] = pOut.x;
    positions[vOffset++] = pOut.y;
    positions[vOffset++] = pOut.z;

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color: colorHex,
    side: THREE.DoubleSide,
    depthTest: depthTest,
    depthWrite: false, // Prevents z-fighting
    transparent: true,
    opacity: isHover ? 0.85 : 0.95,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = renderOrder;
  return mesh;
}

/**
 * Computes shortest distance and closest points between two 3D lines (C1, A1) and (C2, A2)
 */
export function computeClosestPointsBetweenLines(C1, A1, C2, A2) {
  const w = new THREE.Vector3().subVectors(C1, C2);
  const a = A1.dot(A1);
  const b = A1.dot(A2);
  const c = A2.dot(A2);
  const d = A1.dot(w);
  const e = A2.dot(w);
  const denom = a * c - b * b;

  if (denom < 1e-5) {
    // Parallel lines: pick C1 and its orthogonal projection onto line 2
    const t = e / c;
    const P1 = C1.clone();
    const P2 = C2.clone().addScaledVector(A2, t);
    return { P1, P2, distance: P1.distanceTo(P2), isParallel: true, angleDeg: 0.0 };
  }

  const s = (b * e - c * d) / denom;
  const t = (a * e - b * d) / denom;

  const P1 = C1.clone().addScaledVector(A1, s);
  const P2 = C2.clone().addScaledVector(A2, t);
  const acuteAngleRad = Math.acos(Math.min(1.0, Math.abs(b)));
  const angleDeg = (acuteAngleRad * 180) / Math.PI;

  return { P1, P2, distance: P1.distanceTo(P2), isParallel: false, angleDeg };
}

/**
 * Computes closest points between two 3D line segments (p1a -> p1b) and (p2a -> p2b)
 */
export function closestPointsBetweenSegments(p1a, p1b, p2a, p2b) {
  const u = new THREE.Vector3().subVectors(p1b, p1a);
  const v = new THREE.Vector3().subVectors(p2b, p2a);
  const w = new THREE.Vector3().subVectors(p1a, p2a);

  const a = u.dot(u);
  const b = u.dot(v);
  const c = v.dot(v);
  const d = u.dot(w);
  const e = v.dot(w);
  const D = a * c - b * b;

  let sc, sN, sD = D;
  let tc, tN, tD = D;

  if (D < 1e-7) {
    sN = 0.0;
    sD = 1.0;
    tN = e;
    tD = c;
  } else {
    sN = (b * e - c * d);
    tN = (a * e - b * d);
    if (sN < 0.0) {
      sN = 0.0;
      tN = e;
      tD = c;
    } else if (sN > sD) {
      sN = sD;
      tN = e + b;
      tD = c;
    }
  }

  if (tN < 0.0) {
    tc = 0.0;
    if (-d < 0.0) sN = 0.0;
    else if (-d > a) sN = sD;
    else {
      sN = -d;
      sD = a;
    }
  } else if (tN > tD) {
    tc = 1.0;
    if ((-d + b) < 0.0) sN = 0.0;
    else if ((-d + b) > a) sN = sD;
    else {
      sN = (-d + b);
      sD = a;
    }
  } else {
    tc = (Math.abs(tN) < 1e-7) ? 0.0 : tN / tD;
  }

  sc = (Math.abs(sN) < 1e-7) ? 0.0 : sN / sD;

  const pt1 = new THREE.Vector3().addVectors(p1a, u.clone().multiplyScalar(sc));
  const pt2 = new THREE.Vector3().addVectors(p2a, v.clone().multiplyScalar(tc));
  return { pt1, pt2, dist: pt1.distanceTo(pt2), sc, tc };
}

/**
 * Detects whether the clicked/hovered point is near a CAD vertex / corner,
 * checking corner vertices (crease edge junctions, valence >= 2), edge endpoints, or mesh vertices.
 */
export function detectCADVertex(mesh, seedTriangleIndex, hitPoint, snapDist = 15.0) {
  if (!mesh || !mesh.geometry || seedTriangleIndex === undefined || seedTriangleIndex < 0) return null;
  const topology = getMeshTopology(mesh);
  const pos = mesh.geometry.attributes.position;
  if (!pos) return null;

  // 1. If topology is available, check candidate vertices of the seed triangle and its 1-ring neighbors
  if (topology && topology.triangles && topology.triangles[seedTriangleIndex]) {
    const tri = topology.triangles[seedTriangleIndex];
    const candVerts = new Set([tri.a, tri.b, tri.c]);

    // Include 1-ring neighbor triangles to catch corners when clicking slightly off the corner triangle
    if (topology.edgeToTriangles) {
      for (const ek of tri.edges) {
        const nbrs = topology.edgeToTriangles.get(ek);
        if (nbrs) {
          for (const ni of nbrs) {
            if (topology.triangles[ni]) {
              candVerts.add(topology.triangles[ni].a);
              candVerts.add(topology.triangles[ni].b);
              candVerts.add(topology.triangles[ni].c);
            }
          }
        }
      }
    }

    let bestV = null;
    let minDist = Infinity;

    for (const vKey of candVerts) {
      const localPos = topology.vKeyToPos ? topology.vKeyToPos.get(vKey) : null;
      if (!localPos) continue;
      const worldPos = localPos.clone().applyMatrix4(mesh.matrixWorld);
      const d = hitPoint.distanceTo(worldPos);

      // Check if this vertex is a true CAD corner:
      // - Junction of 3 or more crease edges (e.g. cube corner)
      // - Termination of a crease edge (valence 1)
      // - Meeting of 2 crease edges that are NOT collinear (turns an angle)
      const adjCreases = topology.creaseAdjacency ? topology.creaseAdjacency.get(vKey) : null;
      let isCorner = false;
      if (adjCreases && adjCreases.length > 0) {
        if (adjCreases.length >= 3 || adjCreases.length === 1) {
          isCorner = true;
        } else if (adjCreases.length === 2) {
          const nbr1 = topology.vKeyToPos.get(adjCreases[0].nbrKey);
          const nbr2 = topology.vKeyToPos.get(adjCreases[1].nbrKey);
          if (nbr1 && nbr2) {
            const dir1 = nbr1.clone().sub(localPos).normalize();
            const dir2 = nbr2.clone().sub(localPos).normalize();
            if (dir1.dot(dir2) > -0.96) {
              isCorner = true;
            }
          }
        }
      }

      if (isCorner && d <= snapDist && d < minDist) {
        minDist = d;
        bestV = worldPos;
      }
    }

    if (bestV) {
      return {
        point: bestV,
        distance: minDist
      };
    }
  }

  return null;
}

/**
 * Detects whether the clicked/hovered mesh triangle or point is adjacent to a straight CAD edge (arista recta),
 * tracing collinear connected crease edges and extracting exact start point, end point, length, and direction.
 */
export function detectCADStraightEdge(mesh, seedTriangleIndex, hitPoint, cameraRayDirection = null, snapDist = 20.0) {
  if (!mesh || !mesh.geometry) return null;
  const topology = getMeshTopology(mesh);
  if (!topology) return null;

  const { triangles, edgeToTriangles, creaseEdgeSet, creaseAdjacency, vKeyToPos } = topology;
  if (seedTriangleIndex < 0 || seedTriangleIndex >= triangles.length) return null;

  const seedTri = triangles[seedTriangleIndex];
  const candidateEdges = new Set();

  // 1. Gather candidate crease edges from seed triangle
  for (const ek of seedTri.edges) {
    if (creaseEdgeSet && creaseEdgeSet.has(ek)) {
      candidateEdges.add(ek);
    }
  }

  // 2. Check 1-ring neighbor triangles
  for (const ek of seedTri.edges) {
    const nbrs = edgeToTriangles.get(ek) || [];
    for (const ni of nbrs) {
      if (ni === seedTriangleIndex) continue;
      for (const ek2 of triangles[ni].edges) {
        if (creaseEdgeSet && creaseEdgeSet.has(ek2)) {
          candidateEdges.add(ek2);
        }
      }
    }
  }

  // 3. If no candidate yet, check 2-ring neighbor triangles
  if (candidateEdges.size === 0) {
    for (const ek of seedTri.edges) {
      const nbrs = edgeToTriangles.get(ek) || [];
      for (const ni of nbrs) {
        for (const ek2 of triangles[ni].edges) {
          const nbrs2 = edgeToTriangles.get(ek2) || [];
          for (const ni2 of nbrs2) {
            for (const ek3 of triangles[ni2].edges) {
              if (creaseEdgeSet && creaseEdgeSet.has(ek3)) {
                candidateEdges.add(ek3);
              }
            }
          }
        }
      }
    }
  }

  // 4. Fallback: if clicking on a planar face in lines mode, check perimeter edges of the face
  if (candidateEdges.size === 0) {
    const faceData = extractCADPlanarFace(mesh, seedTriangleIndex, hitPoint, cameraRayDirection);
    if (faceData && faceData.boundarySegments && faceData.boundarySegments.length > 0) {
      let bestBoundaryDist = Infinity;
      let bestP1 = null;
      let bestP2 = null;
      const proj = new THREE.Vector3();
      for (let i = 0; i < faceData.boundarySegments.length; i += 2) {
        const bA = faceData.boundarySegments[i];
        const bB = faceData.boundarySegments[i + 1];
        const d = distancePointToSegment(hitPoint, bA, bB, proj);
        if (d < bestBoundaryDist) {
          bestBoundaryDist = d;
          bestP1 = bA;
          bestP2 = bB;
        }
      }
      if (bestBoundaryDist <= snapDist && bestP1 && bestP2) {
        const segLen = bestP1.distanceTo(bestP2);
        if (segLen > 0.05) {
          return {
            type: 'edge',
            p1: bestP1.clone(),
            p2: bestP2.clone(),
            length: Number(segLen.toFixed(3)),
            direction: new THREE.Vector3().subVectors(bestP2, bestP1).normalize(),
            midpoint: new THREE.Vector3().addVectors(bestP1, bestP2).multiplyScalar(0.5),
            hitPoint: hitPoint.clone(),
            mesh: mesh,
            edgeKeys: []
          };
        }
      }
    }
  }

  if (candidateEdges.size === 0) return null;

  // 5. Evaluate candidate edges and pick the closest to hitPoint
  let bestEk = null;
  let minDistance = Infinity;
  const tempProj = new THREE.Vector3();

  for (const ek of candidateEdges) {
    const [ka, kb] = ek.split('#');
    const pLocalA = vKeyToPos.get(ka);
    const pLocalB = vKeyToPos.get(kb);
    if (!pLocalA || !pLocalB) continue;

    const wA = pLocalA.clone().applyMatrix4(mesh.matrixWorld);
    const wB = pLocalB.clone().applyMatrix4(mesh.matrixWorld);
    const d = distancePointToSegment(hitPoint, wA, wB, tempProj);

    if (d < minDistance) {
      minDistance = d;
      bestEk = ek;
    }
  }

  if (!bestEk || minDistance > snapDist) return null;

  // 6. Trace collinear straight line in both directions
  const [startKa, startKb] = bestEk.split('#');
  const pA = vKeyToPos.get(startKa);
  const pB = vKeyToPos.get(startKb);
  if (!pA || !pB) return null;

  const dirLocal = new THREE.Vector3().subVectors(pB, pA).normalize();
  const edgeKeys = [bestEk];
  const visitedVertices = new Set([startKa, startKb]);

  // Walk forward from startKb
  let curKey = startKb;
  let prevKey = startKa;
  while (true) {
    const nbrs = creaseAdjacency.get(curKey) || [];
    let nextKey = null;
    let nextEdgeKey = null;
    let bestDot = 0.998; // ~3.6° collinear tolerance

    for (const item of nbrs) {
      if (item.nbrKey === prevKey || visitedVertices.has(item.nbrKey)) continue;
      const pNext = vKeyToPos.get(item.nbrKey);
      if (!pNext) continue;
      const pCur = vKeyToPos.get(curKey);
      const stepDir = new THREE.Vector3().subVectors(pNext, pCur).normalize();
      const dot = dirLocal.dot(stepDir);
      if (dot > bestDot) {
        bestDot = dot;
        nextKey = item.nbrKey;
        nextEdgeKey = item.edgeKey;
      }
    }

    if (!nextKey) break;
    visitedVertices.add(nextKey);
    edgeKeys.push(nextEdgeKey);
    prevKey = curKey;
    curKey = nextKey;
  }
  const endVertexKey = curKey;

  // Walk backward from startKa
  curKey = startKa;
  prevKey = startKb;
  while (true) {
    const nbrs = creaseAdjacency.get(curKey) || [];
    let nextKey = null;
    let nextEdgeKey = null;
    let bestDot = 0.998;

    for (const item of nbrs) {
      if (item.nbrKey === prevKey || visitedVertices.has(item.nbrKey)) continue;
      const pNext = vKeyToPos.get(item.nbrKey);
      if (!pNext) continue;
      const pCur = vKeyToPos.get(curKey);
      const stepDir = new THREE.Vector3().subVectors(pCur, pNext).normalize();
      const dot = dirLocal.dot(stepDir);
      if (dot > bestDot) {
        bestDot = dot;
        nextKey = item.nbrKey;
        nextEdgeKey = item.edgeKey;
      }
    }

    if (!nextKey) break;
    visitedVertices.add(nextKey);
    edgeKeys.unshift(nextEdgeKey);
    prevKey = curKey;
    curKey = nextKey;
  }
  const startVertexKey = curKey;

  // 7. Check if this edge is an arc of a curved cylinder rim (reject if curved)
  if (edgeKeys.length === 1) {
    const nbrsStart = creaseAdjacency.get(startVertexKey) || [];
    const nbrsEnd = creaseAdjacency.get(endVertexKey) || [];
    let isPartOfArc = false;
    for (const item of [...nbrsStart, ...nbrsEnd]) {
      const pN = vKeyToPos.get(item.nbrKey);
      if (pN) {
        const segD = new THREE.Vector3().subVectors(pN, pA).normalize();
        const d = Math.abs(dirLocal.dot(segD));
        if (d > 0.85 && d < 0.995) {
          isPartOfArc = true;
          break;
        }
      }
    }
    if (isPartOfArc) return null;
  }

  const pStartLocal = vKeyToPos.get(startVertexKey);
  const pEndLocal = vKeyToPos.get(endVertexKey);
  if (!pStartLocal || !pEndLocal) return null;

  const pStartWorld = pStartLocal.clone().applyMatrix4(mesh.matrixWorld);
  const pEndWorld = pEndLocal.clone().applyMatrix4(mesh.matrixWorld);
  const totalLength = pStartWorld.distanceTo(pEndWorld);

  if (totalLength < 0.05) return null;

  return {
    type: 'edge',
    p1: pStartWorld,
    p2: pEndWorld,
    length: Number(totalLength.toFixed(3)),
    direction: new THREE.Vector3().subVectors(pEndWorld, pStartWorld).normalize(),
    midpoint: new THREE.Vector3().addVectors(pStartWorld, pEndWorld).multiplyScalar(0.5),
    hitPoint: hitPoint.clone(),
    mesh: mesh,
    edgeKeys: edgeKeys
  };
}

/**
 * Detects whether the clicked mesh triangle belongs to a cylindrical surface or circular hole,
 * fitting the true CAD cylinder/circle and extracting axis, center, radius, and depth.
 * Applies strict geometric criteria to avoid false positives on rectangular profiles, boxes, or polygons.
 */
export function detectCADCylinderOrCircle(mesh, seedTriangleIndex, hitPoint, cameraRayDirection = null) {
  if (!mesh || !mesh.geometry) return null;
  const topology = getMeshTopology(mesh);
  if (!topology) return null;

  const { triangles, edgeToTriangles, vKeyToPos, creaseAdjacency, creaseEdgeSet, pos } = topology;
  if (seedTriangleIndex < 0 || seedTriangleIndex >= triangles.length) return null;

  const seedTri = triangles[seedTriangleIndex];
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  // 1. PRIMARY: Check if hit triangle touches a circular crease / arista (e.g. hole rim or cylinder shoulder)
  const candidateCreaseEdges = [];
  const addedCandidateEdges = new Set();
  const addCandidate = (ek) => {
    if (creaseEdgeSet && creaseEdgeSet.has(ek) && !addedCandidateEdges.has(ek)) {
      addedCandidateEdges.add(ek);
      candidateCreaseEdges.push(ek);
    }
  };

  for (const ek of seedTri.edges) {
    addCandidate(ek);
  }

  // Also check 1-ring neighbor edges if seedTri is adjacent to a crease rim
  if (candidateCreaseEdges.length === 0 && creaseEdgeSet) {
    for (const ek of seedTri.edges) {
      const nbrs = edgeToTriangles.get(ek) || [];
      for (const ni of nbrs) {
        if (ni === seedTriangleIndex) continue;
        for (const ek2 of triangles[ni].edges) {
          addCandidate(ek2);
        }
      }
    }
  }

  // Sort candidate edges by proximity to hitPoint so the arista closest to the cursor is evaluated first
  if (candidateCreaseEdges.length > 1) {
    candidateCreaseEdges.sort((ekA, ekB) => {
      const [a1, a2] = ekA.split('#');
      const [b1, b2] = ekB.split('#');
      const posA1 = vKeyToPos.get(a1);
      const posA2 = vKeyToPos.get(a2);
      const posB1 = vKeyToPos.get(b1);
      const posB2 = vKeyToPos.get(b2);
      if (!posA1 || !posA2 || !posB1 || !posB2) return 0;
      const midA = new THREE.Vector3().addVectors(posA1, posA2).multiplyScalar(0.5).applyMatrix4(mesh.matrixWorld);
      const midB = new THREE.Vector3().addVectors(posB1, posB2).multiplyScalar(0.5).applyMatrix4(mesh.matrixWorld);
      return midA.distanceToSquared(hitPoint) - midB.distanceToSquared(hitPoint);
    });
  }

  for (const startEk of candidateCreaseEdges) {
    const [startKa, startKb] = startEk.split('#');
    const chain = [startKa, startKb];
    const visited = new Set([startKa, startKb]);
    let isClosed = false;

    // Walk forward from startKb
    let cur = startKb;
    let prev = startKa;
    while (true) {
      const nbrs = creaseAdjacency.get(cur) || [];
      let next = null;

      if (nbrs.length === 1) {
        if (nbrs[0].nbrKey !== prev && !visited.has(nbrs[0].nbrKey)) {
          next = nbrs[0].nbrKey;
        }
      } else {
        // At junctions, prioritize the neighbor continuing the smooth tangent direction
        let bestScore = -Infinity;
        const pCur = vKeyToPos.get(cur);
        const pPrev = vKeyToPos.get(prev);
        const dirIn = (pCur && pPrev) ? new THREE.Vector3().subVectors(pCur, pPrev).normalize() : null;

        for (const item of nbrs) {
          if (item.nbrKey === prev) continue;
          if (item.nbrKey === startKa) {
            isClosed = true;
            next = startKa;
            break;
          }
          if (visited.has(item.nbrKey)) continue;
          if (dirIn && vKeyToPos.has(item.nbrKey)) {
            const dirOut = new THREE.Vector3().subVectors(vKeyToPos.get(item.nbrKey), pCur).normalize();
            const score = dirIn.dot(dirOut);
            if (score > bestScore) {
              bestScore = score;
              next = item.nbrKey;
            }
          } else if (next === null) {
            next = item.nbrKey;
          }
        }
      }

      if (next === null || next === startKa) {
        if (next === startKa) isClosed = true;
        break;
      }
      if (visited.has(next)) break;
      visited.add(next);
      chain.push(next);
      prev = cur;
      cur = next;
    }

    // Walk backward from startKa if not closed
    if (!isClosed) {
      cur = startKa;
      prev = startKb;
      while (true) {
        const nbrs = creaseAdjacency.get(cur) || [];
        let next = null;

        if (nbrs.length === 1) {
          if (nbrs[0].nbrKey !== prev && !visited.has(nbrs[0].nbrKey)) {
            next = nbrs[0].nbrKey;
          }
        } else {
          let bestScore = -Infinity;
          const pCur = vKeyToPos.get(cur);
          const pPrev = vKeyToPos.get(prev);
          const dirIn = (pCur && pPrev) ? new THREE.Vector3().subVectors(pCur, pPrev).normalize() : null;

          for (const item of nbrs) {
            if (item.nbrKey === prev) continue;
            if (visited.has(item.nbrKey)) continue;
            if (dirIn && vKeyToPos.has(item.nbrKey)) {
              const dirOut = new THREE.Vector3().subVectors(vKeyToPos.get(item.nbrKey), pCur).normalize();
              const score = dirIn.dot(dirOut);
              if (score > bestScore) {
                bestScore = score;
                next = item.nbrKey;
              }
            } else if (next === null) {
              next = item.nbrKey;
            }
          }
        }

        if (next === null || visited.has(next)) break;
        visited.add(next);
        chain.unshift(next);
        prev = cur;
        cur = next;
      }
    }

    // STRICT VALIDATION 1: A circular hole or cylinder rim MUST have at least 8 vertices if closed, or 6 if an arc.
    // Rectangles (4 vertices) and triangles (3 vertices) are NEVER circles!
    if (isClosed && chain.length < 8) continue;
    if (!isClosed && chain.length < 6) continue;

    const ptsWorld = chain.map(k => vKeyToPos.get(k).clone().applyMatrix4(mesh.matrixWorld));
    const nPts = ptsWorld.length;

    // STRICT VALIDATION 2: Check turn angles along the chain.
    // In a CAD circular edge, adjacent segments have small turn angles (e.g. 15-22.5 deg; at coarse 8-gon = 45 deg).
    // A rectangle has sharp 90 deg corners! A triangle has 120 deg.
    let hasSharpCorner = false;
    for (let i = 0; i < (isClosed ? nPts : nPts - 2); i++) {
      const idxPrev = isClosed ? (i - 1 + nPts) % nPts : i;
      const idxCur = isClosed ? i : i + 1;
      const idxNext = isClosed ? (i + 1) % nPts : i + 2;

      const pPrev = ptsWorld[idxPrev];
      const pCur = ptsWorld[idxCur];
      const pNext = ptsWorld[idxNext];

      const d1 = new THREE.Vector3().subVectors(pCur, pPrev);
      const d2 = new THREE.Vector3().subVectors(pNext, pCur);
      const l1 = d1.length();
      const l2 = d2.length();
      if (l1 < 1e-6 || l2 < 1e-6) continue;

      const dot = Math.max(-1, Math.min(1, d1.dot(d2) / (l1 * l2)));
      const turnDeg = Math.acos(dot) * (180 / Math.PI);
      if (turnDeg > 52.0) {
        hasSharpCorner = true;
        break;
      }
    }
    if (hasSharpCorner) continue;

    // STRICT VALIDATION 3: Chord length uniformity along the circular rim.
    // In a rectangle, width vs height chord lengths differ drastically (e.g. 400mm vs 50mm).
    let minChord = Infinity, maxChord = 0;
    for (let i = 0; i < (isClosed ? nPts : nPts - 1); i++) {
      const ch = ptsWorld[i].distanceTo(ptsWorld[(i + 1) % nPts]);
      if (ch < minChord) minChord = ch;
      if (ch > maxChord) maxChord = ch;
    }
    if (maxChord > 0 && (minChord / maxChord) < 0.25) {
      continue;
    }

    let sumX = 0, sumY = 0, sumZ = 0;
    ptsWorld.forEach(p => { sumX += p.x; sumY += p.y; sumZ += p.z; });
    const mean = new THREE.Vector3(sumX / nPts, sumY / nPts, sumZ / nPts);

    let fittedNorm = new THREE.Vector3();
    for (let i = 0; i < nPts; i++) {
      const p1 = ptsWorld[i];
      const p2 = ptsWorld[(i + 1) % nPts];
      const v1 = new THREE.Vector3().subVectors(p1, mean);
      const v2 = new THREE.Vector3().subVectors(p2, mean);
      const cross = new THREE.Vector3().crossVectors(v1, v2);
      fittedNorm.add(cross);
    }

    if (fittedNorm.lengthSq() > 1e-8) {
      fittedNorm.normalize();
      canonicalizeAxis(fittedNorm);

      const { U, V } = getOrthonormalBasis(fittedNorm);
      const pts2D = ptsWorld.map(p => {
        const d = new THREE.Vector3().subVectors(p, mean);
        return { u: d.dot(U), v: d.dot(V) };
      });

      const fit = fitCircle2D(pts2D);
      if (fit && fit.r > 0.1 && fit.relError < 0.035) {
        // STRICT VALIDATION 4: Angular distribution around center.
        // For a closed circle, there must NOT be a large angular gap (> 52 deg) between consecutive vertices.
        // A rectangle has gaps of 90 deg or 140 deg!
        const polarAngles = pts2D.map(p => Math.atan2(p.v - fit.vc, p.u - fit.uc)).sort((a, b) => a - b);
        let maxGap = 0;
        for (let i = 0; i < polarAngles.length; i++) {
          const gap = (i === polarAngles.length - 1)
            ? (polarAngles[0] + 2 * Math.PI - polarAngles[i])
            : (polarAngles[i + 1] - polarAngles[i]);
          if (gap > maxGap) maxGap = gap;
        }
        const maxGapDeg = maxGap * (180 / Math.PI);
        if (isClosed && maxGapDeg > 52.0) {
          continue;
        }
        if (!isClosed) {
          let maxInnerGap = 0;
          for (let i = 0; i < polarAngles.length - 1; i++) {
            const g = polarAngles[i + 1] - polarAngles[i];
            if (g > maxInnerGap) maxInnerGap = g;
          }
          if (maxInnerGap * (180 / Math.PI) > 35.0) continue;
        }

        const rimCenterWorld = mean.clone().addScaledVector(U, fit.uc).addScaledVector(V, fit.vc);
        const radius = fit.r;
        const diameter = radius * 2;

        // Check if there is an attached cylinder wall along the rim
        const cylSeeds = [];
        for (let i = 0; i < nPts; i++) {
          const ka = chain[i];
          const kb = chain[(i + 1) % nPts];
          const ek = ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
          const tris = edgeToTriangles.get(ek) || [];
          for (const ti of tris) {
            const tri = triangles[ti];
            const triNormWorld = tri.normal.clone().applyMatrix3(normalMatrix).normalize();
            if (Math.abs(triNormWorld.dot(fittedNorm)) < 0.35) {
              cylSeeds.push(ti);
            }
          }
        }

        let depth = 0;
        let centerWorld = rimCenterWorld.clone();
        let topCenterWorld = rimCenterWorld.clone();
        let bottomCenterWorld = rimCenterWorld.clone();
        let nearestRimCenterWorld = rimCenterWorld.clone();
        let otherRimCenterWorld = null;
        let cylGeom = null;
        let isHole = true;
        let visitedCyl = new Set();
        let cylTriangles = [];

        if (cylSeeds.length > 0) {
          const cylQueue = [...cylSeeds];
          cylSeeds.forEach(ti => visitedCyl.add(ti));
          cylTriangles = cylSeeds.map(ti => triangles[ti]);

          while (cylQueue.length > 0 && cylTriangles.length < 20000) {
            const curIdx = cylQueue.shift();
            const curTri = triangles[curIdx];

            for (const ek of curTri.edges) {
              const nbrs = edgeToTriangles.get(ek) || [];
              for (const ni of nbrs) {
                if (visitedCyl.has(ni)) continue;
                const nbr = triangles[ni];
                const nbrNormWorld = nbr.normal.clone().applyMatrix3(normalMatrix).normalize();
                if (Math.abs(nbrNormWorld.dot(fittedNorm)) > 0.35) continue;

                visitedCyl.add(ni);
                cylTriangles.push(nbr);
                cylQueue.push(ni);
              }
            }
          }

          // STRICT VALIDATION 5: Validate that the attached wall is actually cylindrical (not flat rectangular sides)
          const centerAxis = rimCenterWorld.clone().sub(fittedNorm.clone().multiplyScalar(rimCenterWorld.dot(fittedNorm)));
          let badCentroids = 0;
          let badNormals = 0;
          const tempV = new THREE.Vector3();

          for (const tri of cylTriangles) {
            const triCentroid = new THREE.Vector3();
            for (let k = 0; k < 3; k++) {
              tempV.fromBufferAttribute(pos, tri.indices[k]).applyMatrix4(mesh.matrixWorld);
              triCentroid.add(tempV);
            }
            triCentroid.multiplyScalar(1 / 3);

            const projOnAxis = centerAxis.clone().addScaledVector(fittedNorm, triCentroid.dot(fittedNorm));
            const distToAxis = triCentroid.distanceTo(projOnAxis);
            if (Math.abs(distToAxis - radius) / radius > 0.12) {
              badCentroids++;
            }

            const radDir = new THREE.Vector3().subVectors(triCentroid, projOnAxis).normalize();
            const triNormWorld = tri.normal.clone().applyMatrix3(normalMatrix).normalize();
            if (Math.abs(triNormWorld.dot(radDir)) < 0.80) {
              badNormals++;
            }
          }

          const isWallCylindrical = (badCentroids <= cylTriangles.length * 0.15) && (badNormals <= cylTriangles.length * 0.20);

          if (isWallCylindrical) {
            let hMin = Infinity, hMax = -Infinity;
            const cylPositions = new Float32Array(cylTriangles.length * 9);
            let cOffset = 0;

            for (const tri of cylTriangles) {
              for (let k = 0; k < 3; k++) {
                tempV.fromBufferAttribute(pos, tri.indices[k]).applyMatrix4(mesh.matrixWorld);
                cylPositions[cOffset++] = tempV.x;
                cylPositions[cOffset++] = tempV.y;
                cylPositions[cOffset++] = tempV.z;
                const h = tempV.dot(fittedNorm);
                if (h < hMin) hMin = h;
                if (h > hMax) hMax = h;
              }
            }

            depth = Math.max(0, hMax - hMin);
            const midH = (hMin + hMax) * 0.5;
            centerWorld = centerAxis.clone().addScaledVector(fittedNorm, midH);

            topCenterWorld = centerAxis.clone().addScaledVector(fittedNorm, hMax);
            bottomCenterWorld = centerAxis.clone().addScaledVector(fittedNorm, hMin);

            const hitH = hitPoint.dot(fittedNorm);
            const nearRimH = Math.abs(hitH - hMin) < Math.abs(hitH - hMax) ? hMin : hMax;
            const farRimH = nearRimH === hMin ? hMax : hMin;
            nearestRimCenterWorld = centerAxis.clone().addScaledVector(fittedNorm, nearRimH);
            otherRimCenterWorld = centerAxis.clone().addScaledVector(fittedNorm, farRimH);

            cylGeom = new THREE.BufferGeometry();
            cylGeom.setAttribute('position', new THREE.BufferAttribute(cylPositions, 3));
            cylGeom.computeVertexNormals();

            const sampleV = new THREE.Vector3().fromBufferAttribute(pos, cylTriangles[0].indices[0]).applyMatrix4(mesh.matrixWorld);
            const sampleProj = centerAxis.clone().addScaledVector(fittedNorm, sampleV.dot(fittedNorm));
            const radDir = new THREE.Vector3().subVectors(sampleV, sampleProj).normalize();
            const triNormWorld = cylTriangles[0].normal.clone().applyMatrix3(normalMatrix).normalize();
            isHole = radDir.dot(triNormWorld) < 0;
          } else {
            // Wall failed validation -> flat plate or rectangular profile, reset depth
            cylTriangles = [];
            visitedCyl = new Set();
            depth = 0;
          }
        }

        return {
          type: depth > 0.05 ? 'cylinder' : 'circle',
          isHole,
          label: depth > 0.05 ? (isHole ? 'Orificio Cilíndrico' : 'Cilindro / Eje') : 'Arista Circular',
          mesh,
          radius,
          diameter,
          depth,
          center: centerWorld,
          rimCenter: nearestRimCenterWorld,
          otherRimCenter: otherRimCenterWorld,
          topCenter: topCenterWorld,
          bottomCenter: bottomCenterWorld,
          axis: fittedNorm,
          U,
          V,
          cylinderGeometry: cylGeom,
          boundaryGeometry: null,
          triangleIndicesSet: visitedCyl.size > 0 ? visitedCyl : new Set([seedTriangleIndex]),
          trianglesCount: cylTriangles.length > 0 ? cylTriangles.length : chain.length,
          hitPoint: hitPoint.clone()
        };
      }
    }
  }

  // 2. SECONDARY: Cylinder Wall Detection (when user clicks on a cylindrical wall)
  // On a cylindrical surface, neighboring facets curve continuously.
  let candidateAxis = null;
  const bfsQueue = [seedTriangleIndex];
  const bfsVisited = new Set([seedTriangleIndex]);
  const maxBfsSearch = 64;

  while (bfsQueue.length > 0 && bfsVisited.size < maxBfsSearch && !candidateAxis) {
    const curIdx = bfsQueue.shift();
    const curTri = triangles[curIdx];

    for (const ek of curTri.edges) {
      const nbrs = edgeToTriangles.get(ek) || [];
      for (const ni of nbrs) {
        if (bfsVisited.has(ni)) continue;
        bfsVisited.add(ni);
        const nbr = triangles[ni];
        const dot = seedTri.normal.dot(nbr.normal);
        // Adjacent facets on a cylinder have dot between 0.70 (coarse 8-gon) and 0.9995
        if (dot > 0.70 && dot < 0.9995) {
          const cross = new THREE.Vector3().crossVectors(seedTri.normal, nbr.normal);
          if (cross.lengthSq() > 1e-6) {
            candidateAxis = cross.normalize();
            break;
          }
        }
        bfsQueue.push(ni);
      }
      if (candidateAxis) break;
    }
  }

  if (candidateAxis) {
    const worldAxis = candidateAxis.clone().applyMatrix3(normalMatrix).normalize();
    canonicalizeAxis(worldAxis);
    const { U, V } = getOrthonormalBasis(worldAxis);

    const queue = [seedTriangleIndex];
    const visited = new Set([seedTriangleIndex]);
    const cylTriangles = [seedTri];
    const maxTris = 20000;

    while (queue.length > 0 && cylTriangles.length < maxTris) {
      const curIdx = queue.shift();
      const curTri = triangles[curIdx];

      for (const ek of curTri.edges) {
        const nbrs = edgeToTriangles.get(ek) || [];
        for (const ni of nbrs) {
          if (visited.has(ni)) continue;
          const nbr = triangles[ni];
          if (Math.abs(nbr.normal.dot(candidateAxis)) > 0.16) continue;

          visited.add(ni);
          cylTriangles.push(nbr);
          queue.push(ni);
        }
      }
    }

    // A real cylinder requires multiple facets
    if (cylTriangles.length >= 8) {
      const uniqueVerts = new Map();
      const tempV = new THREE.Vector3();

      for (const tri of cylTriangles) {
        for (const idx of tri.indices) {
          if (!uniqueVerts.has(idx)) {
            tempV.fromBufferAttribute(pos, idx).applyMatrix4(mesh.matrixWorld);
            uniqueVerts.set(idx, tempV.clone());
          }
        }
      }

      if (uniqueVerts.size >= 8) {
        const pts2D = [];
        let hMin = Infinity, hMax = -Infinity;

        for (const p of uniqueVerts.values()) {
          const u = p.dot(U);
          const v = p.dot(V);
          const h = p.dot(worldAxis);
          pts2D.push({ u, v, h, p });
          if (h < hMin) hMin = h;
          if (h > hMax) hMax = h;
        }

        const fit = fitCircle2D(pts2D);
        if (fit && fit.r >= 0.1 && fit.relError <= 0.035) {
          // STRICT VALIDATION 1: Unique cross-section vertices (quantized by 0.1% of radius)
          const quant2D = Math.max(1e-4, fit.r * 1e-3);
          const unique2DMap = new Map();
          for (const pt of pts2D) {
            const k = `${Math.round(pt.u / quant2D)}_${Math.round(pt.v / quant2D)}`;
            if (!unique2DMap.has(k)) {
              unique2DMap.set(k, { u: pt.u, v: pt.v });
            }
          }
          const uniqueCrossPts = Array.from(unique2DMap.values());
          // A rectangle only has 4 unique cross-section points! A CAD cylinder has >= 8.
          if (uniqueCrossPts.length < 8) {
            return null;
          }

          // STRICT VALIDATION 2: Angular distribution of unique cross-section points
          const polarAngles = uniqueCrossPts.map(p => Math.atan2(p.v - fit.vc, p.u - fit.uc)).sort((a, b) => a - b);
          let maxCrossGap = 0;
          for (let i = 0; i < polarAngles.length; i++) {
            const gap = (i === polarAngles.length - 1)
              ? (polarAngles[0] + 2 * Math.PI - polarAngles[i])
              : (polarAngles[i + 1] - polarAngles[i]);
            if (gap > maxCrossGap) maxCrossGap = gap;
          }
          const maxCrossGapDeg = maxCrossGap * (180 / Math.PI);
          // If closed cylinder: max gap between adjacent facets <= 52 deg (rectangle has 90 or 140 deg!)
          if (maxCrossGapDeg > 52.0) {
            // Check if it's a valid open arc / fillet
            let maxArcInnerGap = 0;
            for (let i = 0; i < polarAngles.length - 1; i++) {
              const g = polarAngles[i + 1] - polarAngles[i];
              if (g > maxArcInnerGap) maxArcInnerGap = g;
            }
            const totalSpanDeg = (polarAngles[polarAngles.length - 1] - polarAngles[0]) * (180 / Math.PI);
            if (maxArcInnerGap * (180 / Math.PI) > 35.0 || totalSpanDeg < 45.0 || uniqueCrossPts.length < 6) {
              return null;
            }
          }

          const radius = fit.r;
          const diameter = radius * 2;
          const depth = Math.max(0.01, hMax - hMin);

          const centerAxis = new THREE.Vector3().addScaledVector(U, fit.uc).addScaledVector(V, fit.vc);

          // STRICT VALIDATION 3: Centroid distance of all triangles to cylinder axis
          let badCentroids = 0;
          for (const tri of cylTriangles) {
            const triCentroid = new THREE.Vector3();
            for (let k = 0; k < 3; k++) {
              tempV.fromBufferAttribute(pos, tri.indices[k]).applyMatrix4(mesh.matrixWorld);
              triCentroid.add(tempV);
            }
            triCentroid.multiplyScalar(1 / 3);

            const projOnAxis = centerAxis.clone().addScaledVector(worldAxis, triCentroid.dot(worldAxis));
            const distToAxis = triCentroid.distanceTo(projOnAxis);
            if (Math.abs(distToAxis - radius) / radius > 0.12) {
              badCentroids++;
            }
          }
          if (badCentroids > cylTriangles.length * 0.12) {
            return null;
          }

          // STRICT VALIDATION 4: Normal radial alignment and normal diversity
          const normBins = new Set();
          let badNormals = 0;
          for (const tri of cylTriangles) {
            const triCentroid = new THREE.Vector3();
            for (let k = 0; k < 3; k++) {
              tempV.fromBufferAttribute(pos, tri.indices[k]).applyMatrix4(mesh.matrixWorld);
              triCentroid.add(tempV);
            }
            triCentroid.multiplyScalar(1 / 3);

            const projOnAxis = centerAxis.clone().addScaledVector(worldAxis, triCentroid.dot(worldAxis));
            const radDir = new THREE.Vector3().subVectors(triCentroid, projOnAxis).normalize();
            const triNormWorld = tri.normal.clone().applyMatrix3(normalMatrix).normalize();

            if (Math.abs(triNormWorld.dot(radDir)) < 0.82) {
              badNormals++;
            }

            const nU = triNormWorld.dot(U);
            const nV = triNormWorld.dot(V);
            normBins.add(Math.round(Math.atan2(nV, nU) / (Math.PI / 12)));
          }
          if (badNormals > cylTriangles.length * 0.15 || normBins.size < 6) {
            return null;
          }

          const midHeight = (hMin + hMax) * 0.5;
          const centerWorld = centerAxis.clone().addScaledVector(worldAxis, midHeight);

          const hitH = hitPoint.dot(worldAxis);
          const nearRimH = Math.abs(hitH - hMin) < Math.abs(hitH - hMax) ? hMin : hMax;
          const farRimH = nearRimH === hMin ? hMax : hMin;
          const rimCenterWorld = centerAxis.clone().addScaledVector(worldAxis, nearRimH);
          const otherRimCenterWorld = centerAxis.clone().addScaledVector(worldAxis, farRimH);
          const topCenter = centerAxis.clone().addScaledVector(worldAxis, hMax);
          const bottomCenter = centerAxis.clone().addScaledVector(worldAxis, hMin);

          const sampleV = pts2D[0].p;
          const sampleProj = centerAxis.clone().addScaledVector(worldAxis, sampleV.dot(worldAxis));
          const radDir = new THREE.Vector3().subVectors(sampleV, sampleProj).normalize();
          const seedNormalWorld = seedTri.normal.clone().applyMatrix3(normalMatrix).normalize();
          const isHole = radDir.dot(seedNormalWorld) < 0;

          const vertexPositions = new Float32Array(cylTriangles.length * 9);
          let vOffset = 0;
          for (const tri of cylTriangles) {
            for (let k = 0; k < 3; k++) {
              tempV.fromBufferAttribute(pos, tri.indices[k]).applyMatrix4(mesh.matrixWorld);
              vertexPositions[vOffset++] = tempV.x;
              vertexPositions[vOffset++] = tempV.y;
              vertexPositions[vOffset++] = tempV.z;
            }
          }

          const cylinderGeometry = new THREE.BufferGeometry();
          cylinderGeometry.setAttribute('position', new THREE.BufferAttribute(vertexPositions, 3));
          cylinderGeometry.computeVertexNormals();

          return {
            type: 'cylinder',
            isHole,
            label: isHole ? 'Orificio Cilíndrico' : 'Cilindro / Eje',
            mesh,
            radius,
            diameter,
            depth,
            center: centerWorld,
            rimCenter: rimCenterWorld,
            otherRimCenter: otherRimCenterWorld,
            topCenter,
            bottomCenter,
            axis: worldAxis,
            U,
            V,
            cylinderGeometry,
            boundaryGeometry: null,
            triangleIndicesSet: visited,
            trianglesCount: cylTriangles.length,
            hitPoint: hitPoint.clone()
          };
        }
      }
    }
  }

  return null;
}

export class MeasurementTool {
  constructor(viewer) {
    this.viewer = viewer;

    this.isActive = false;
    this.mode = 'smart'; // Default to auto / smart CAD mode

    // Multi-step selections
    this.firstSelection = null;
    this.secondSelection = null;
    this.arcPoints = []; // For 3-point circle / arc measurement

    this.currentMeasurement = null;
    this.badges = [];
    this.statusPrompt = '';

    // 3D Depth & X-Ray behavior:
    // When false (default): respects realistic 3D occlusion (markers don't blindly shine through solid walls).
    // When true: X-Ray mode (measurements always visible through geometry).
    this.xray = false;

    // Click debouncing
    this.lastClickTime = 0;
    this.raycaster = new THREE.Raycaster();

    // Backup of controls mouse buttons to restore on deactivate
    this._savedMouseButtons = null;

    // 3D Visual Root Group
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'measurementRootGroup';
    if (this.viewer && this.viewer.scene) {
      this.viewer.scene.add(this.rootGroup);
    }

    // Hover Face Highlight Group (subtle glow on hover)
    this.hoverGroup = new THREE.Group();
    this.hoverGroup.name = 'measurementHoverGroup';
    this.rootGroup.add(this.hoverGroup);
    this.currentHoverMesh = null;
    this.currentHoverFaceData = null;

    // Hover Snap Marker (smart subtle CAD cursor dot that tracks model surface)
    const snapGeom = new THREE.SphereGeometry(0.7, 16, 16);
    const snapMat = new THREE.MeshBasicMaterial({
      color: COLOR_ITEM1,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      transparent: true,
      opacity: 0.95
    });
    this.snapMarker = new THREE.Mesh(snapGeom, snapMat);
    this.snapMarker.visible = false;
    this.snapMarker.renderOrder = 3000;
    this.rootGroup.add(this.snapMarker);

    // Hover normal ring indicator (shows plane orientation on hover)
    const ringGeom = new THREE.RingGeometry(1.0, 1.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: COLOR_ITEM1,
      side: THREE.DoubleSide,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      transparent: true,
      opacity: 0.75
    });
    this.snapMarkerRing = new THREE.Mesh(ringGeom, ringMat);
    this.snapMarkerRing.visible = false;
    this.snapMarkerRing.renderOrder = 3001;
    this.rootGroup.add(this.snapMarkerRing);

    // Active dimension lines and indicators
    this.visualsGroup = new THREE.Group();
    this.rootGroup.add(this.visualsGroup);

    // Selected features highlights (exact CAD face meshes and boundaries)
    this.selectionGroup = new THREE.Group();
    this.rootGroup.add(this.selectionGroup);

    // Persistent saved measurements group (multi-measurement retention)
    this.savedGroup = new THREE.Group();
    this.savedGroup.name = 'measurementSavedGroup';
    this.rootGroup.add(this.savedGroup);
    this.savedMeasurements = [];
    this.keepMeasurementsOnExit = true;

    // Bound event handlers
    this._pointerDownPos = null;
    this._pointerDownTime = 0;
    this._pointerMoved = false;

    this._onPointerDown = (event) => {
      if (event.button === 0) {
        this._pointerDownPos = { x: event.clientX, y: event.clientY };
        this._pointerDownTime = performance.now();
        this._pointerMoved = false;
      }
    };
    this._onPointerMove = (event) => {
      if (this._pointerDownPos) {
        const dist = Math.hypot(event.clientX - this._pointerDownPos.x, event.clientY - this._pointerDownPos.y);
        if (dist > 5) {
          this._pointerMoved = true;
        }
      }
      this.onPointerMove(event);
    };
    this._onClick = this.onClick.bind(this);

    this.isDarkTheme = !!(viewer && viewer.isDarkTheme);
    this.onUpdateCallback = null;
  }

  getDimensionColor() {
    return this.isDarkTheme ? COLOR_DIMENSION_DARK : COLOR_DIMENSION_LIGHT;
  }

  setDarkTheme(isDark) {
    this.isDarkTheme = !!isDark;
    const colorHex = this.getDimensionColor();
    const updateMeshColor = (root) => {
      if (!root) return;
      root.traverse((child) => {
        if (child.userData && child.userData.isDimensionLine) {
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m && m.color && m.color.setHex(colorHex));
            } else if (child.material.color) {
              child.material.color.setHex(colorHex);
            }
          }
        }
      });
    };
    updateMeshColor(this.visualsGroup);
    updateMeshColor(this.savedGroup);
  }

  hasVisibleBadges() {
    return (this.badges && this.badges.length > 0) || (this.savedMeasurements && this.savedMeasurements.length > 0);
  }

  // Dynamic getters ensure non-stale references
  get scene() {
    return this.viewer?.scene;
  }

  get camera() {
    return this.viewer?.camera;
  }

  get renderer() {
    return this.viewer?.renderer;
  }

  get viewport() {
    return this.viewer?.viewport;
  }

  activate(onUpdateCallback = null) {
    if (this.isActive) return;
    this.isActive = true;
    this.onUpdateCallback = onUpdateCallback;
    this.reset();

    // Ensure rootGroup is in scene
    if (this.scene && !this.scene.children.includes(this.rootGroup)) {
      this.scene.add(this.rootGroup);
    }

    // LOCK OrbitControls left-click while measuring so clicks NEVER jerk or rotate the scene!
    if (this.viewer && this.viewer.controls) {
      this._savedMouseButtons = { ...this.viewer.controls.mouseButtons };
      this.viewer.controls.mouseButtons = {
        LEFT: null, // Left click is purely for CAD feature picking!
        MIDDLE: THREE.MOUSE.DOLLY, // Middle click or scroll wheel zooms
        RIGHT: THREE.MOUSE.ROTATE // Right click orbits/rotates the camera freely
      };
    }

    const dom = this.renderer?.domElement;
    if (dom) {
      dom.addEventListener('pointerdown', this._onPointerDown, false);
      dom.addEventListener('pointermove', this._onPointerMove, false);
      dom.addEventListener('click', this._onClick, false);
      dom.style.cursor = 'crosshair';
    }

    this.updateDefaultPrompt();
    console.log('[CAD Measure] Activated in mode:', this.mode, 'Camera ready.');
    this.emitUpdate();
  }

  deactivate() {
    if (!this.isActive) return;

    // Commit any completed measurement before closing if user wants to keep measurements
    if (this.keepMeasurementsOnExit) {
      if (this.currentMeasurement && this.secondSelection) {
        this.commitCurrentMeasurement();
      } else if (this.currentMeasurement && !this.firstSelection && !this.savedMeasurements.some(m => m.data === this.currentMeasurement)) {
        this.commitCurrentMeasurement();
      } else {
        this.resetCurrent();
        this.clearVisuals();
      }
    } else {
      this.clearAllMeasurements();
    }

    this.isActive = false;
    this.snapMarker.visible = false;
    if (this.snapMarkerRing) this.snapMarkerRing.visible = false;
    this.clearHoverFace();

    // Restore standard OrbitControls mouse buttons
    if (this.viewer && this.viewer.controls && this._savedMouseButtons) {
      this.viewer.controls.mouseButtons = { ...this._savedMouseButtons };
      this._savedMouseButtons = null;
    }

    const dom = this.renderer?.domElement;
    if (dom) {
      dom.removeEventListener('pointerdown', this._onPointerDown, false);
      dom.removeEventListener('pointermove', this._onPointerMove, false);
      dom.removeEventListener('click', this._onClick, false);
      dom.style.cursor = 'default';
    }
    this._pointerDownPos = null;
    this._pointerMoved = false;

    console.log('[CAD Measure] Deactivated. Standard navigation restored. Active saved cotas:', this.savedMeasurements.length);
    this.emitUpdate();
  }

  setMode(mode) {
    this.mode = mode;
    this.reset();
    console.log('[CAD Measure] Mode switched to:', mode);
  }

  setXray(enabled) {
    this.xray = !!enabled;
    if (this.snapMarker && this.snapMarker.material) {
      this.snapMarker.material.depthTest = !this.xray;
    }
    if (this.snapMarkerRing && this.snapMarkerRing.material) {
      this.snapMarkerRing.material.depthTest = !this.xray;
    }
    console.log('[CAD Measure] X-Ray mode:', this.xray);
    this.refreshVisuals();
  }

  refreshVisuals() {
    if (!this.firstSelection) return;
    const snap1 = this.firstSelection;
    const snap2 = this.secondSelection;

    this.clearSelectionVisuals();
    this.clearVisualsOnly();

    if (snap1.cylData) {
      this.selectionGroup.add(this.renderCylinderHighlight(snap1.cylData, COLOR_ITEM1, false, '1'));
    } else if (snap1.edgeData) {
      this.selectionGroup.add(this.renderCADEdgeHighlight(snap1.edgeData, COLOR_ITEM1, false, '1'));
    } else if (snap1.faceData) {
      this.selectionGroup.add(this.renderCADFaceHighlight(snap1.faceData, COLOR_ITEM1, false, '1'));
    } else if (snap1.point) {
      this.renderPointMarker(snap1.point, COLOR_ITEM1, '1');
    }

    if (snap2) {
      if (snap2.cylData) {
        this.selectionGroup.add(this.renderCylinderHighlight(snap2.cylData, COLOR_ITEM2, false, '2'));
        if (snap1.cylData) {
          this.computeCylindersMeasurement(snap1.cylData, snap2.cylData);
        } else if (snap1.edgeData) {
          this.computeLineAndCylinderMeasurement(snap1.edgeData, snap2.cylData);
        } else if (snap1.faceData) {
          this.computePlaneAndCylinderMeasurement(snap1.faceData, snap2.cylData);
        } else if (snap1.point) {
          this.computePointAndCylinderMeasurement(snap1.point, snap2.cylData);
        }
      } else if (snap2.edgeData) {
        this.selectionGroup.add(this.renderCADEdgeHighlight(snap2.edgeData, COLOR_ITEM2, false, '2'));
        if (snap1.edgeData) {
          this.computeLinesMeasurement(snap1.edgeData, snap2.edgeData);
        } else if (snap1.faceData) {
          this.computeLineAndPlaneMeasurement(snap2.edgeData, snap1.faceData);
        } else if (snap1.cylData) {
          this.computeLineAndCylinderMeasurement(snap2.edgeData, snap1.cylData);
        } else if (snap1.point) {
          this.computeLineAndPointMeasurement(snap2.edgeData, snap1.point);
        }
      } else if (snap2.faceData) {
        this.selectionGroup.add(this.renderCADFaceHighlight(snap2.faceData, COLOR_ITEM2, false, '2'));
        if (snap1.faceData) {
          this.computePlanesMeasurement(snap1, snap2);
        } else if (snap1.edgeData) {
          this.computeLineAndPlaneMeasurement(snap1.edgeData, snap2.faceData);
        } else if (snap1.cylData) {
          this.computePlaneAndCylinderMeasurement(snap2.faceData, snap1.cylData);
        } else if (snap1.point) {
          this.computePointAndPlaneMeasurement(snap1.point, snap2.faceData);
        }
      } else if (snap2.point) {
        this.renderPointMarker(snap2.point, COLOR_ITEM2, '2');
        if (snap1.edgeData) {
          this.computeLineAndPointMeasurement(snap1.edgeData, snap2.point);
        } else if (snap1.faceData) {
          this.computePointAndPlaneMeasurement(snap2.point, snap1.faceData);
        } else if (snap1.cylData) {
          this.computePointAndCylinderMeasurement(snap2.point, snap1.cylData);
        } else {
          this.computeDistanceMeasurement(snap1, snap2);
        }
      }
    }
  }

  clearVisualsOnly() {
    while (this.visualsGroup.children.length > 0) {
      const child = this.visualsGroup.children[0];
      this.visualsGroup.remove(child);
      if (child.traverse) {
        child.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    }
  }

  updateDefaultPrompt() {
    if (this.mode === 'planes') {
      this.statusPrompt = 'Haz clic en la primera cara plana...';
    } else if (this.mode === 'lines') {
      this.statusPrompt = 'Haz clic en la primera arista o línea recta...';
    } else if (this.mode === 'radius') {
      this.statusPrompt = 'Haz clic en un orificio cilíndrico o arista curva...';
    } else if (this.mode === 'distance') {
      this.statusPrompt = 'Haz clic en el primer punto sobre el modelo 3D...';
    } else {
      this.statusPrompt = 'Haz clic en cualquier punto, arista, orificio o cara para medir...';
    }
  }

  resetCurrent() {
    this.firstSelection = null;
    this.secondSelection = null;
    this.arcPoints = [];
    this.currentMeasurement = null;
    this.updateDefaultPrompt();
    this.clearHoverFace();
    this.clearSelectionVisuals();
  }

  reset() {
    this.resetCurrent();
    this.clearVisuals();
    this.badges = [];
    this.emitUpdate();
  }

  clearSelectionVisuals() {
    this.clearHoverFace();
    while (this.selectionGroup.children.length > 0) {
      const child = this.selectionGroup.children[0];
      this.selectionGroup.remove(child);
      if (child.traverse) {
        child.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    }
  }

  clearVisuals() {
    this.clearSelectionVisuals();
    while (this.visualsGroup.children.length > 0) {
      const child = this.visualsGroup.children[0];
      this.visualsGroup.remove(child);
      if (child.traverse) {
        child.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    }
    this.badges = [];
  }

  getAllBadges() {
    const all = [];
    if (this.savedMeasurements) {
      for (let i = 0; i < this.savedMeasurements.length; i++) {
        const sm = this.savedMeasurements[i];
        if (sm.badges) {
          for (let j = 0; j < sm.badges.length; j++) {
            all.push(sm.badges[j]);
          }
        }
      }
    }
    if (this.badges && this.badges.length > 0) {
      for (let k = 0; k < this.badges.length; k++) {
        all.push(this.badges[k]);
      }
    }
    return all;
  }

  commitCurrentMeasurement() {
    if (!this.currentMeasurement) return null;

    const mId = 'cota_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const subGroup = new THREE.Group();
    subGroup.name = `savedGroup_${mId}`;

    // Transfer children from selectionGroup and visualsGroup to subGroup
    while (this.selectionGroup.children.length > 0) {
      const child = this.selectionGroup.children[0];
      this.selectionGroup.remove(child);
      subGroup.add(child);
    }
    while (this.visualsGroup.children.length > 0) {
      const child = this.visualsGroup.children[0];
      this.visualsGroup.remove(child);
      subGroup.add(child);
    }

    this.savedGroup.add(subGroup);

    const targetMeshes = this.currentMeasurement.targetMeshes || [];
    const targetPoints = this.currentMeasurement.targetPoints || [];
    const targetFaces = this.currentMeasurement.targetFaces || [];
    const targetEdges = this.currentMeasurement.targetEdges || [];
    const targetCylinders = this.currentMeasurement.targetCylinders || [];

    const savedBadges = this.badges.map((b, idx) => ({
      ...b,
      id: `${mId}_b${idx}`,
      measureId: mId,
      worldPos: b.worldPos ? b.worldPos.clone() : new THREE.Vector3(),
      isSaved: true,
      offsetX: b.offsetX || 0,
      offsetY: b.offsetY || 0,
      targetMeshes: targetMeshes,
      targetPoints: targetPoints,
      targetFaces: targetFaces,
      targetEdges: targetEdges,
      targetCylinders: targetCylinders
    }));

    const savedEntry = {
      id: mId,
      data: { ...this.currentMeasurement, id: mId },
      group: subGroup,
      badges: savedBadges,
      targetMeshes: targetMeshes,
      targetPoints: targetPoints,
      targetFaces: targetFaces,
      targetEdges: targetEdges,
      targetCylinders: targetCylinders,
      face1: this.currentMeasurement.face1,
      face2: this.currentMeasurement.face2,
      signedDist: this.currentMeasurement.signedDist,
      isParallel: this.currentMeasurement.isParallel,
      perpDist: this.currentMeasurement.perpDist,
      P1: this.currentMeasurement.P1,
      P2: this.currentMeasurement.P2,
      n1: this.currentMeasurement.n1
    };

    this.savedMeasurements.push(savedEntry);

    this.resetCurrent();
    this.badges = [];
    this.emitUpdate();
    return savedEntry;
  }

  deleteMeasurement(measureId) {
    if (!measureId) return;

    // Check if it matches active draft
    if (this.currentMeasurement && (this.currentMeasurement.id === measureId || !this.currentMeasurement.id)) {
      this.reset();
    }

    const idx = this.savedMeasurements.findIndex(m => m.id === measureId || m.badges.some(b => b.id === measureId || b.measureId === measureId));
    if (idx !== -1) {
      const item = this.savedMeasurements[idx];
      if (item.group && item.group.parent) {
        item.group.parent.remove(item.group);
        item.group.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
      }
      this.savedMeasurements.splice(idx, 1);
      this.emitUpdate();
    }
  }

  clearAllMeasurements() {
    while (this.savedGroup.children.length > 0) {
      const child = this.savedGroup.children[0];
      this.savedGroup.remove(child);
      if (child.traverse) {
        child.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
      }
    }
    this.savedMeasurements = [];
    this.resetCurrent();
    this.clearVisuals();
    this.badges = [];
    this.emitUpdate();
  }

  setKeepMeasurementsOnExit(enabled) {
    this.keepMeasurementsOnExit = !!enabled;
    this.emitUpdate();
  }

  getModelScale() {
    if (this.viewer && this.viewer.obj) {
      const box = new THREE.Box3().setFromObject(this.viewer.obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      return Math.max(size.x, size.y, size.z, 10);
    }
    return 100;
  }

  getSnapThreshold(worldPoint) {
    if (!this.camera || !this.renderer) return 5.0;
    const camDist = this.camera.position.distanceTo(worldPoint);
    const fovRad = ((this.camera.fov || 45) * Math.PI) / 180.0;
    const canvasHeight = Math.max(100, this.renderer.domElement.clientHeight);
    const worldPerPixel = (2.0 * Math.tan(fovRad / 2.0) * camDist) / canvasHeight;
    return Math.max(1.0, Math.min(25.0, worldPerPixel * 16.0));
  }

  getPointerNDC(event) {
    const dom = this.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return new THREE.Vector2(0, 0);
    const x = ((event.clientX - rect.left) / rect.width) * 2.0 - 1.0;
    const y = -((event.clientY - rect.top) / rect.height) * 2.0 + 1.0;
    return new THREE.Vector2(x, y);
  }

  onPointerMove(event) {
    if (!this.isActive || !this.viewer || !this.viewer.obj || !this.camera) return;

    try {
      const ndc = this.getPointerNDC(event);
      const snap = this.findSmartSnap(ndc);
      if (snap) {
        this.snapMarker.position.copy(snap.point);
        const markerScale = Math.max(0.5, this.getSnapThreshold(snap.point) * 0.15);
        this.snapMarker.scale.set(markerScale, markerScale, markerScale);

        if (this.mode === 'distance') {
          this.clearHoverFace();
          this.snapMarker.visible = true;
          if (this.snapMarkerRing) this.snapMarkerRing.visible = false;
        } else {
          this.updateHoverFace(snap);
        }
      } else {
        this.snapMarker.visible = false;
        if (this.snapMarkerRing) this.snapMarkerRing.visible = false;
        this.clearHoverFace();
      }
    } catch (err) {
      console.error('[CAD Measure] Error on pointer move:', err);
    }
  }

  /**
   * Single click handler: cleanly handles Step 1 and Step 2 with zero duplicates
   */
  onClick(event) {
    if (!this.isActive || !this.viewer || !this.viewer.obj || !this.camera) return;
    if (event.button !== undefined && event.button !== 0) return; // Only left-click

    // Reject drag, long-press hold, or camera navigation
    if (this._pointerMoved) return;
    const dt = performance.now() - (this._pointerDownTime || 0);
    if (dt > 350) return;
    if (this.viewer && (this.viewer._isNavigating || this.viewer._hasCameraMoved)) return;

    const now = Date.now();
    if (now - this.lastClickTime < 250) return; // Prevent double-triggering
    this.lastClickTime = now;

    try {
      const ndc = this.getPointerNDC(event);
      const snap = this.findSmartSnap(ndc);
      if (!snap) return;

      this.processSelection(snap);
    } catch (err) {
      console.error('[CAD Measure] Error on click selection:', err);
    }
  }

  /**
   * Fast smart snapping: finds exact point, normal, vertex or edge
   */
  findSmartSnap(ndc) {
    if (!this.viewer.obj || !this.camera) return null;
    this.raycaster.setFromCamera(ndc, this.camera);

    let intersects = this.raycaster.intersectObject(this.viewer.obj, true);
    if (!intersects || intersects.length === 0) return null;
    intersects.sort((a, b) => a.distance - b.distance);

    const validHits = [];
    for (let i = 0; i < intersects.length; i++) {
      const hit = intersects[i];
      if (!hit.object.isMesh) continue;
      // Completely ignore section cut cap, stencil meshes, plane helpers, and measurement overlays
      if (hit.object.userData.isStencilMesh || hit.object.userData.isHelperMesh || hit.object.userData.isCapMesh) continue;
      if (this.viewer.capMesh && hit.object === this.viewer.capMesh) continue;
      if (this.viewer.capGroup && (hit.object === this.viewer.capGroup || hit.object.parent === this.viewer.capGroup)) continue;
      if (this.viewer.customPlaneHelper && hit.object === this.viewer.customPlaneHelper) continue;

      // Ignore hidden parts, isolated-out parts, and invisible meshes
      if (this.viewer.isMeshVisibleInView && !this.viewer.isMeshVisibleInView(hit.object)) {
        continue;
      }

      // When section cut is active, exclude points on geometry clipped away by the cutting plane
      if (this.viewer.sectionActive && this.viewer.sectionPlane) {
        if (this.viewer.sectionPlane.distanceToPoint(hit.point) < -0.005) {
          continue;
        }
      }
      validHits.push(hit);
    }

    // Check for Section Cut Circle Snap (or inside cut circle cap) if section is active and not in 'planes' mode
    if (this.mode !== 'planes' && this.viewer.sectionActive && this.viewer.sectionPlane && typeof this.viewer.getSectionCutCircles === 'function') {
      const cutCircles = this.viewer.getSectionCutCircles();
      if (cutCircles && cutCircles.length > 0) {
        const hitPlanePt = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.viewer.sectionPlane, hitPlanePt)) {
          const toHit = hitPlanePt.clone().sub(this.raycaster.ray.origin);
          if (toHit.dot(this.raycaster.ray.direction) > 0) {
            const cutDist = toHit.length();
            const firstHitDist = validHits.length > 0 ? validHits[0].distance : Infinity;
            if (firstHitDist >= cutDist - 1.0) {
              const threshold = this.getSnapThreshold(hitPlanePt);
              for (let c = 0; c < cutCircles.length; c++) {
                const circ = cutCircles[c];
                const distToCenter = hitPlanePt.distanceTo(circ.center);
                const distToRim = Math.abs(distToCenter - circ.radius);

                // In radius mode, snap anywhere inside the circular slice or near circumference
                // In other modes, snap within threshold of circumference
                const isRadiusMode = (this.mode === 'radius');
                const isNearCircumference = distToRim <= threshold * 1.5;
                const isInsideCap = isRadiusMode && (distToCenter <= circ.radius + threshold);

                if (isNearCircumference || isInsideCap) {
                  const radVec = hitPlanePt.clone().sub(circ.center);
                  const radLen = radVec.length();
                  const rimPt = radLen > 1e-4
                    ? circ.center.clone().addScaledVector(radVec.normalize(), circ.radius)
                    : circ.center.clone().addScaledVector(circ.U, circ.radius);

                  return {
                    type: 'circle',
                    point: isNearCircumference ? rimPt : circ.center.clone(),
                    normal: circ.axis.clone(),
                    cutCircle: circ,
                    cylData: circ,
                    edgeData: circ.pathEdges && circ.pathEdges.length > 0 ? circ.pathEdges[0] : null,
                    rawHit: { object: circ.mesh, point: hitPlanePt.clone(), faceIndex: 0 },
                    isCutCircle: true
                  };
                }
              }
            }
          }
        }
      }
    }

    // Check for Section Cut Edge Snap if section is active and not in 'planes' mode
    if (this.mode !== 'planes' && this.viewer.sectionActive && this.viewer.sectionPlane && typeof this.viewer.getSectionCutEdges === 'function') {
      const cutEdges = this.viewer.getSectionCutEdges();
      if (cutEdges && cutEdges.length > 0) {
        let bestCutEdge = null;
        let minCutDistSq = Infinity;
        let bestCutPtSeg = null;
        const ptRay = new THREE.Vector3();
        const ptSeg = new THREE.Vector3();

        for (let i = 0; i < cutEdges.length; i++) {
          const edge = cutEdges[i];
          const dSq = this.raycaster.ray.distanceSqToSegment(edge.p1, edge.p2, ptRay, ptSeg);
          if (ptRay.clone().sub(this.raycaster.ray.origin).dot(this.raycaster.ray.direction) > 0) {
            const threshold = this.getSnapThreshold(ptSeg);
            if (dSq <= threshold * threshold && dSq < minCutDistSq) {
              minCutDistSq = dSq;
              bestCutEdge = edge;
              bestCutPtSeg = ptSeg.clone();
            }
          }
        }

        if (bestCutEdge) {
          const cutDist = this.raycaster.ray.origin.distanceTo(bestCutPtSeg);
          const firstHitDist = validHits.length > 0 ? validHits[0].distance : Infinity;
          const isOccluded = firstHitDist < cutDist - 1.0;
          if (!isOccluded) {
            let snapType = 'edge';
            let snappedPoint = bestCutPtSeg.clone();
            const threshold = this.getSnapThreshold(bestCutPtSeg);

            if (bestCutEdge.cutCircle) {
              return {
                type: 'circle',
                point: snappedPoint,
                normal: this.viewer.sectionPlane.normal.clone(),
                cutCircle: bestCutEdge.cutCircle,
                cylData: bestCutEdge.cutCircle,
                edgeData: bestCutEdge,
                rawHit: { object: bestCutEdge.mesh, point: bestCutPtSeg, faceIndex: 0 },
                isCutCircle: true,
                isCutEdge: true
              };
            }

            if (this.mode === 'distance' || this.mode === 'smart') {
              const d1 = bestCutPtSeg.distanceTo(bestCutEdge.p1);
              const d2 = bestCutPtSeg.distanceTo(bestCutEdge.p2);
              if (Math.min(d1, d2) < threshold * 0.7) {
                snapType = 'vertex';
                snappedPoint = d1 < d2 ? bestCutEdge.p1.clone() : bestCutEdge.p2.clone();
              }
            }

            return {
              type: snapType,
              point: snappedPoint,
              normal: this.viewer.sectionPlane.normal.clone(),
              edgeData: bestCutEdge,
              rawHit: { object: bestCutEdge.mesh, point: bestCutPtSeg, faceIndex: 0 },
              isCutEdge: true
            };
          }
        }
      }
    }

    if (validHits.length === 0) return null;
    const validHit = validHits[0];
    const mesh = validHit.object;
    const hitPoint = validHit.point;
    const face = validHit.face;

    // 1. Calculate true geometric world normal of the hit triangle
    let worldNormal = new THREE.Vector3(0, 0, 1);
    if (face && mesh.geometry && mesh.geometry.attributes.position) {
      const pos = mesh.geometry.attributes.position;
      const vA = new THREE.Vector3().fromBufferAttribute(pos, face.a).applyMatrix4(mesh.matrixWorld);
      const vB = new THREE.Vector3().fromBufferAttribute(pos, face.b).applyMatrix4(mesh.matrixWorld);
      const vC = new THREE.Vector3().fromBufferAttribute(pos, face.c).applyMatrix4(mesh.matrixWorld);

      const edge1 = new THREE.Vector3().subVectors(vB, vA);
      const edge2 = new THREE.Vector3().subVectors(vC, vA);
      worldNormal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      // Ensure normal points outward toward camera ray direction
      if (this.raycaster.ray.direction.dot(worldNormal) > 0) {
        worldNormal.negate();
      }
    }

    let snapType = 'face';
    let snappedPoint = hitPoint.clone();

    // In 'planes' mode, maintain face selection without snapping to edges/vertices
    if (this.mode !== 'planes' && face && mesh.geometry && mesh.geometry.attributes.position) {
      const pos = mesh.geometry.attributes.position;
      const vA = new THREE.Vector3().fromBufferAttribute(pos, face.a).applyMatrix4(mesh.matrixWorld);
      const vB = new THREE.Vector3().fromBufferAttribute(pos, face.b).applyMatrix4(mesh.matrixWorld);
      const vC = new THREE.Vector3().fromBufferAttribute(pos, face.c).applyMatrix4(mesh.matrixWorld);

      const dA = hitPoint.distanceTo(vA);
      const dB = hitPoint.distanceTo(vB);
      const dC = hitPoint.distanceTo(vC);
      const minVertexD = Math.min(dA, dB, dC);

      const snapThreshold = this.getSnapThreshold(hitPoint);

      if (this.mode === 'smart') {
        const vData = detectCADVertex(mesh, validHit.faceIndex, hitPoint, snapThreshold);
        if (vData) {
          snapType = 'vertex';
          snappedPoint = vData.point.clone();
        }
      } else if (minVertexD < snapThreshold * 0.6) {
        snapType = 'vertex';
        snappedPoint = (dA === minVertexD ? vA : (dB === minVertexD ? vB : vC)).clone();
      } else {
        const pSegAB = new THREE.Vector3();
        const pSegBC = new THREE.Vector3();
        const pSegCA = new THREE.Vector3();
        const dAB = distancePointToSegment(hitPoint, vA, vB, pSegAB);
        const dBC = distancePointToSegment(hitPoint, vB, vC, pSegBC);
        const dCA = distancePointToSegment(hitPoint, vC, vA, pSegCA);
        const minEdgeD = Math.min(dAB, dBC, dCA);

        if (minEdgeD < snapThreshold) {
          snapType = 'edge';
          if (minEdgeD === dAB) {
            snappedPoint = pSegAB.clone();
          } else if (minEdgeD === dBC) {
            snappedPoint = pSegBC.clone();
          } else {
            snappedPoint = pSegCA.clone();
          }
        }
      }
    }

    return {
      type: snapType,
      point: snappedPoint,
      normal: worldNormal,
      mesh,
      rawHit: validHit
    };
  }

  /**
   * Main selection dispatcher
   */
  processSelection(snap) {
    // If a measurement was already complete, automatically commit it to persistent cotas so it stays visible!
    if (this.secondSelection || (this.mode !== 'radius' && this.currentMeasurement && !this.firstSelection) || (this.mode === 'radius' && this.currentMeasurement && this.secondSelection)) {
      this.commitCurrentMeasurement();
    }

    if (this.mode === 'planes') {
      this.processPlanesSelection(snap);
    } else if (this.mode === 'lines') {
      this.processLinesSelection(snap);
    } else if (this.mode === 'radius') {
      this.processRadiusSelection(snap);
    } else if (this.mode === 'smart') {
      this.processSmartSelection(snap);
    } else {
      this.processDistanceSelection(snap);
    }
  }

  /**
   * Process Straight Line / Edge selection (aristas CAD rectas)
   */
  processLinesSelection(snap) {
    let edgeData = snap.edgeData || null;
    if (!edgeData && snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined) {
      edgeData = detectCADStraightEdge(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction, 50.0);
    }

    if (!edgeData) {
      this.statusPrompt = 'No se detectó una arista recta cerca del cursor. Haz clic sobre una arista o borde del modelo.';
      this.emitUpdate();
      return;
    }

    snap.edgeData = edgeData;
    snap.type = 'edge';
    snap.point = edgeData.midpoint.clone();

    if (!this.firstSelection) {
      this.firstSelection = snap;
      this.clearHoverFace();
      this.selectionGroup.add(this.renderCADEdgeHighlight(edgeData, COLOR_ITEM1, false, '1'));
      this.computeSingleEdgeMeasurement(edgeData);
    } else {
      const firstEdge = this.firstSelection.edgeData;
      if (
        firstEdge &&
        firstEdge.p1.distanceTo(edgeData.p1) < 0.1 &&
        firstEdge.p2.distanceTo(edgeData.p2) < 0.1
      ) {
        console.log('[CAD Measure] Clic en la misma arista que Arista 1. Ignorado.');
        return;
      }

      this.secondSelection = snap;
      this.clearHoverFace();
      this.selectionGroup.add(this.renderCADEdgeHighlight(edgeData, COLOR_ITEM2, false, '2'));
      this.computeLinesMeasurement(firstEdge, edgeData);
    }
  }

  /**
   * Process Planar Faces selection and perpendicular/angle calculation
   */
  processPlanesSelection(snap) {
    if (!this.firstSelection) {
      // Step 1: Select Face 1
      const faceData = snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined
        ? extractCADPlanarFace(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction)
        : null;

      snap.faceData = faceData;
      if (faceData) {
        snap.normal = faceData.normal;
      }
      this.firstSelection = snap;

      this.clearHoverFace();
      if (faceData) {
        this.selectionGroup.add(this.renderCADFaceHighlight(faceData, COLOR_ITEM1, false, '1'));
      } else {
        this.renderPlaneHighlight(snap.point, snap.normal, COLOR_ITEM1, '1');
      }

      this.statusPrompt = `Cara 1 fijada en (${snap.point.x.toFixed(1)}, ${snap.point.y.toFixed(1)}, ${snap.point.z.toFixed(1)}). Ahora haz clic en la segunda cara plana...`;
      console.log('[CAD Measure] Cara 1 locked with exact CAD face geometry:', !!faceData);
      this.emitUpdate();
    } else {
      // Step 2: Select Face 2
      const dist = this.firstSelection.point.distanceTo(snap.point);
      if (dist < 0.1) {
        console.log('[CAD Measure] Clic en el mismo punto que Cara 1 (< 0.1mm). Ignorado.');
        return;
      }

      const faceData = snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined
        ? extractCADPlanarFace(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction)
        : null;

      snap.faceData = faceData;
      if (faceData) {
        snap.normal = faceData.normal;
      }
      this.secondSelection = snap;

      this.clearHoverFace();
      if (faceData) {
        this.selectionGroup.add(this.renderCADFaceHighlight(faceData, COLOR_ITEM2, false, '2'));
      } else {
        this.renderPlaneHighlight(snap.point, snap.normal, COLOR_ITEM2, '2');
      }

      console.log('[CAD Measure] Cara 2 locked with exact CAD face geometry:', !!faceData);
      this.computePlanesMeasurement(this.firstSelection, this.secondSelection);
    }
  }

  /**
   * Process Radius / Cylinder / Hole selection (Bambu Studio / OrcaSlicer style)
   */
  processRadiusSelection(snap) {
    // 1. Try automatic CAD cylinder / hole / cut circle detection
    let cylData = snap.cutCircle || (snap.edgeData && snap.edgeData.cutCircle) || snap.cylData || null;
    if (!cylData && snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined) {
      cylData = detectCADCylinderOrCircle(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction);
    }

    if (cylData) {
      this.arcPoints = [];

      if (!this.firstSelection) {
        // Step 1: Select Cylinder 1
        snap.cylData = cylData;
        this.firstSelection = snap;

        this.clearHoverFace();
        this.selectionGroup.add(this.renderCylinderHighlight(cylData, COLOR_ITEM1, false, '1'));

        // Display immediate single cylinder measurement!
        this.computeSingleCylinderMeasurement(cylData);
      } else {
        // Step 2: Select Cylinder 2
        if (
          this.firstSelection.cylData &&
          (
            this.firstSelection.cylData === cylData ||
            (
              this.firstSelection.cylData.mesh === (snap.rawHit && snap.rawHit.object) &&
              this.firstSelection.cylData.triangleIndicesSet &&
              this.firstSelection.cylData.triangleIndicesSet.has(snap.rawHit && snap.rawHit.faceIndex)
            )
          )
        ) {
          console.log('[CAD Measure] Clic en el mismo cilindro que Cilindro 1. Ignorado.');
          return;
        }

        snap.cylData = cylData;
        this.secondSelection = snap;

        this.clearHoverFace();
        this.selectionGroup.add(this.renderCylinderHighlight(cylData, COLOR_ITEM2, false, '2'));

        this.computeCylindersMeasurement(this.firstSelection.cylData, cylData);
      }
    } else {
      // 2. Fallback: 3-Point Arc / Circle measurement
      this.arcPoints.push(snap.point.clone());

      if (this.arcPoints.length === 1) {
        this.renderPointMarker(snap.point, COLOR_ITEM1, 'A');
        this.statusPrompt = 'Punto 1/3 fijado. Haz clic en el 2º punto del arco o circunferencia...';
        this.emitUpdate();
      } else if (this.arcPoints.length === 2) {
        this.renderPointMarker(snap.point, COLOR_ITEM1, 'B');
        this.statusPrompt = 'Punto 2/3 fijado. Haz clic en el 3º punto para calcular el radio...';
        this.emitUpdate();
      } else if (this.arcPoints.length >= 3) {
        const [A, B, C] = this.arcPoints;
        const circleData = circumcenter3D(A, B, C);

        if (circleData && circleData.radius > 0.05) {
          this.secondSelection = snap;
          this.renderPointMarker(snap.point, COLOR_ITEM2, 'C');
          this.render3PointCircleVisual(circleData, A, B, C);

          this.currentMeasurement = {
            type: 'arc_3point',
            title: 'Círculo por 3 Puntos (Arco)',
            distance: circleData.diameter,
            unit: 'mm',
            primaryValue: `Ø ${circleData.diameter.toFixed(2)} mm`,
            secondaryValue: `Radio: ${circleData.radius.toFixed(2)} mm`,
            targetMeshes: [snap.mesh || (snap.rawHit && snap.rawHit.object)].filter(Boolean),
            targetPoints: [A, B, C].filter(Boolean),
            details: [
              { label: 'Diámetro (Ø)', value: `Ø ${circleData.diameter.toFixed(2)} mm` },
              { label: 'Radio (R)', value: `${circleData.radius.toFixed(2)} mm` },
              { label: 'Centro 3D', value: `(${circleData.center.x.toFixed(1)}, ${circleData.center.y.toFixed(1)}, ${circleData.center.z.toFixed(1)})` },
              { label: 'Normal del Plano', value: `[${circleData.normal.x.toFixed(2)}, ${circleData.normal.y.toFixed(2)}, ${circleData.normal.z.toFixed(2)}]` },
              { label: 'Punto 1', value: `(${A.x.toFixed(1)}, ${A.y.toFixed(1)}, ${A.z.toFixed(1)})` },
              { label: 'Punto 2', value: `(${B.x.toFixed(1)}, ${B.y.toFixed(1)}, ${B.z.toFixed(1)})` },
              { label: 'Punto 3', value: `(${C.x.toFixed(1)}, ${C.y.toFixed(1)}, ${C.z.toFixed(1)})` }
            ]
          };

          this.statusPrompt = `Círculo calculado: Ø ${circleData.diameter.toFixed(2)} mm (R: ${circleData.radius.toFixed(2)} mm). Haz clic para otra medición.`;
          this.emitUpdate();
        } else {
          this.statusPrompt = 'Puntos colineales o inválidos. Haz clic de nuevo.';
          this.arcPoints = [];
          this.emitUpdate();
        }
      }
    }
  }

  /**
   * Computes Center-to-Center Distance, Axial Perpendicular Distance, Wall Clearance,
   * and Axis Angle between two detected cylinders
   */
  computeCylindersMeasurement(cyl1, cyl2) {
    const closest = computeClosestPointsBetweenLines(cyl1.center, cyl1.axis, cyl2.center, cyl2.axis);
    const isParallel = closest.isParallel || closest.angleDeg < 5.0;

    let C1, C2;
    if (isParallel) {
      // For parallel cylinders, pair corresponding reference points (e.g. top opening to top opening)
      if (cyl1.topCenter && cyl2.topCenter) {
        C1 = cyl1.topCenter;
        C2 = cyl2.topCenter;
      } else {
        C1 = cyl1.center;
        C2 = cyl2.center;
      }
    } else {
      C1 = cyl1.center;
      C2 = cyl2.center;
    }

    const directDist = C1.distanceTo(C2);
    const deltaX = Math.abs(C2.x - C1.x);
    const deltaY = Math.abs(C2.y - C1.y);
    const deltaZ = Math.abs(C2.z - C1.z);

    // Wall clearance: distance between closest cylinder surfaces
    const wallClearance = Math.max(0, closest.distance - cyl1.radius - cyl2.radius);
    const primaryDist = isParallel ? closest.distance : directDist;

    const measurement = {
      type: 'cylinders_distance',
      title: 'Distancia entre Cilindros / Orificios',
      distance: primaryDist,
      unit: 'mm',
      primaryValue: `${primaryDist.toFixed(2)} mm (Centros)`,
      secondaryValue: `Pared mín.: ${wallClearance.toFixed(2)} mm | Ejes ${isParallel ? 'Paralelos (0.0°)' : `${closest.angleDeg.toFixed(1)}°`}`,
      targetMeshes: [cyl1.mesh, cyl2.mesh].filter(Boolean),
      targetPoints: [C1, C2].filter(Boolean),
      details: [
        { label: 'Distancia entre Centros 3D', value: `${directDist.toFixed(2)} mm` },
        { label: 'Distancia Perpendicular entre Ejes', value: `${closest.distance.toFixed(2)} mm` },
        { label: 'Espesor Mínimo de Pared (Gap)', value: `${wallClearance.toFixed(2)} mm` },
        { label: 'Relación de Ejes', value: isParallel ? 'Paralelos (0.0°)' : `Ángulo: ${closest.angleDeg.toFixed(1)}°` },
        { label: cyl1.label || 'Cilindro 1', value: `Ø ${cyl1.diameter.toFixed(2)} mm (R: ${cyl1.radius.toFixed(2)} mm)` },
        { label: cyl2.label || 'Cilindro 2', value: `Ø ${cyl2.diameter.toFixed(2)} mm (R: ${cyl2.radius.toFixed(2)} mm)` },
        { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
        { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
        { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
        { label: 'Centro 1', value: formatVec3(C1) },
        { label: 'Centro 2', value: formatVec3(C2) }
      ]
    };

    this.currentMeasurement = measurement;
    this.statusPrompt = `Distancia entre centros: ${primaryDist.toFixed(2)} mm. Haz clic de nuevo para otra medición.`;
    this.renderCylinderDimensionVisual(cyl1, cyl2, closest, C1, C2);
    this.emitUpdate();
  }

  /**
   * Smart mode selection:
   * Seamlessly detects and combines:
   * - Points / Vertices (CAD corners, endpoints, cut vertices)
   * - Cylinders / Holes / Circular Rims
   * - Straight Lines / Edges (CAD crease boundaries, cut edges)
   * - Planar Faces
   * Supports all 10 pairwise combinations with CAD cotas and full dimension details.
   */
  processSmartSelection(snap) {
    let selectedItem = null;

    // 1. Check if clicked on a CAD Vertex / Corner
    if (snap.type === 'vertex') {
      selectedItem = {
        kind: 'vertex',
        point: snap.point.clone()
      };
    }

    // 1.5 Check Cut Circle (or circle edge)
    const cutCirc = snap.cutCircle || (snap.edgeData && snap.edgeData.cutCircle);
    if (!selectedItem && cutCirc) {
      selectedItem = {
        kind: 'cylinder',
        cylData: cutCirc,
        point: (cutCirc.topCenter || cutCirc.rimCenter || cutCirc.center).clone()
      };
    }

    // 2. Check Cylinder / Hole / Circle
    if (!selectedItem && snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined) {
      const cylData = detectCADCylinderOrCircle(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction);
      if (cylData) {
        selectedItem = {
          kind: 'cylinder',
          cylData,
          point: (cylData.topCenter || cylData.rimCenter || cylData.center).clone()
        };
      }
    }

    // 3. Check Straight CAD Edge (or Section Cut Edge)
    if (!selectedItem) {
      let edgeData = snap.edgeData || null;
      if (!edgeData && snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined) {
        const snapThreshold = this.getSnapThreshold(snap.point);
        edgeData = detectCADStraightEdge(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction, snapThreshold);
      }
      if (edgeData) {
        selectedItem = {
          kind: 'edge',
          edgeData,
          point: edgeData.midpoint.clone()
        };
      }
    }

    // 4. Check Planar Face
    if (!selectedItem && snap.rawHit && snap.rawHit.object && snap.rawHit.faceIndex !== undefined) {
      const faceData = extractCADPlanarFace(snap.rawHit.object, snap.rawHit.faceIndex, snap.point, this.raycaster.ray.direction);
      if (faceData) {
        selectedItem = {
          kind: 'face',
          faceData,
          normal: faceData.normal.clone(),
          point: snap.point.clone()
        };
      }
    }

    // 5. Fallback: Freeform 3D point on surface
    if (!selectedItem) {
      selectedItem = {
        kind: 'vertex',
        point: snap.point.clone()
      };
    }

    // Handling Step 1 (first item selection)
    if (!this.firstSelection) {
      snap.type = selectedItem.kind;
      snap.point = selectedItem.point;
      if (selectedItem.cylData) snap.cylData = selectedItem.cylData;
      if (selectedItem.edgeData) snap.edgeData = selectedItem.edgeData;
      if (selectedItem.faceData) {
        snap.faceData = selectedItem.faceData;
        snap.normal = selectedItem.normal;
      }
      this.firstSelection = snap;
      this.clearHoverFace();

      if (selectedItem.kind === 'vertex') {
        this.renderPointMarker(snap.point, COLOR_ITEM1, '1');
        this.statusPrompt = `Punto 1 fijado en (${snap.point.x.toFixed(1)}, ${snap.point.y.toFixed(1)}, ${snap.point.z.toFixed(1)}). Ahora selecciona el segundo elemento (punto, arista, cara o orificio)...`;
      } else if (selectedItem.kind === 'cylinder') {
        this.selectionGroup.add(this.renderCylinderHighlight(selectedItem.cylData, COLOR_ITEM1, false, '1'));
        this.computeSingleCylinderMeasurement(selectedItem.cylData);
      } else if (selectedItem.kind === 'edge') {
        this.selectionGroup.add(this.renderCADEdgeHighlight(selectedItem.edgeData, COLOR_ITEM1, false, '1'));
        this.computeSingleEdgeMeasurement(selectedItem.edgeData);
      } else if (selectedItem.kind === 'face') {
        this.selectionGroup.add(this.renderCADFaceHighlight(selectedItem.faceData, COLOR_ITEM1, false, '1'));
        this.statusPrompt = 'Cara 1 fijada. Haz clic en la segunda cara, arista, orificio o punto...';
      }
      this.emitUpdate();
      return;
    }

    // Handling Step 2 (second item selection and measurement dispatch)
    const dist = this.firstSelection.point.distanceTo(selectedItem.point);
    if (selectedItem.kind === 'edge' && this.firstSelection.edgeData) {
      const e1 = this.firstSelection.edgeData;
      const e2 = selectedItem.edgeData;
      if (e1.p1.distanceTo(e2.p1) < 0.1 && e1.p2.distanceTo(e2.p2) < 0.1) return;
    } else if (selectedItem.kind === 'vertex' && this.firstSelection.type === 'vertex') {
      if (dist < 0.1) return;
    }

    snap.type = selectedItem.kind;
    snap.point = selectedItem.point;
    if (selectedItem.cylData) snap.cylData = selectedItem.cylData;
    if (selectedItem.edgeData) snap.edgeData = selectedItem.edgeData;
    if (selectedItem.faceData) {
      snap.faceData = selectedItem.faceData;
      snap.normal = selectedItem.normal;
    }
    this.secondSelection = snap;
    this.clearHoverFace();

    if (selectedItem.kind === 'vertex') {
      this.renderPointMarker(snap.point, COLOR_ITEM2, '2');
    } else if (selectedItem.kind === 'cylinder') {
      this.selectionGroup.add(this.renderCylinderHighlight(selectedItem.cylData, COLOR_ITEM2, false, '2'));
    } else if (selectedItem.kind === 'edge') {
      this.selectionGroup.add(this.renderCADEdgeHighlight(selectedItem.edgeData, COLOR_ITEM2, false, '2'));
    } else if (selectedItem.kind === 'face') {
      this.selectionGroup.add(this.renderCADFaceHighlight(selectedItem.faceData, COLOR_ITEM2, false, '2'));
    }

    const sel1 = this.firstSelection;
    const sel2 = this.secondSelection;

    // Dispatch all combinations
    if (sel1.cylData && sel2.cylData) {
      this.computeCylindersMeasurement(sel1.cylData, sel2.cylData);
    } else if (sel1.cylData && sel2.edgeData) {
      this.computeLineAndCylinderMeasurement(sel2.edgeData, sel1.cylData);
    } else if (sel1.edgeData && sel2.cylData) {
      this.computeLineAndCylinderMeasurement(sel1.edgeData, sel2.cylData);
    } else if (sel1.cylData && sel2.faceData) {
      this.computePlaneAndCylinderMeasurement(sel2.faceData, sel1.cylData);
    } else if (sel1.faceData && sel2.cylData) {
      this.computePlaneAndCylinderMeasurement(sel1.faceData, sel2.cylData);
    } else if (sel1.cylData && (sel2.type === 'vertex' || sel2.point)) {
      this.computePointAndCylinderMeasurement(sel2.point, sel1.cylData);
    } else if ((sel1.type === 'vertex' || sel1.point) && sel2.cylData) {
      this.computePointAndCylinderMeasurement(sel1.point, sel2.cylData);
    } else if (sel1.edgeData && sel2.edgeData) {
      this.computeLinesMeasurement(sel1.edgeData, sel2.edgeData);
    } else if (sel1.edgeData && sel2.faceData) {
      this.computeLineAndPlaneMeasurement(sel1.edgeData, sel2.faceData);
    } else if (sel1.faceData && sel2.edgeData) {
      this.computeLineAndPlaneMeasurement(sel2.edgeData, sel1.faceData);
    } else if (sel1.edgeData && (sel2.type === 'vertex' || sel2.point)) {
      this.computeLineAndPointMeasurement(sel1.edgeData, sel2.point);
    } else if ((sel1.type === 'vertex' || sel1.point) && sel2.edgeData) {
      this.computeLineAndPointMeasurement(sel2.edgeData, sel1.point);
    } else if (sel1.faceData && sel2.faceData) {
      this.computePlanesMeasurement(sel1, sel2);
    } else if (sel1.faceData && (sel2.type === 'vertex' || sel2.point)) {
      this.computePointAndPlaneMeasurement(sel2.point, sel1.faceData);
    } else if ((sel1.type === 'vertex' || sel1.point) && sel2.faceData) {
      this.computePointAndPlaneMeasurement(sel1.point, sel2.faceData);
    } else {
      this.computeDistanceMeasurement(sel1, sel2);
    }
  }

  /**
   * Process 3D Point to Point distance selection
   */
  processDistanceSelection(snap) {
    if (!this.firstSelection) {
      this.firstSelection = snap;
      this.renderPointMarker(snap.point, COLOR_ITEM1, '1');
      this.statusPrompt = `Punto 1 fijado en (${snap.point.x.toFixed(1)}, ${snap.point.y.toFixed(1)}, ${snap.point.z.toFixed(1)}). Ahora haz clic en el segundo punto...`;
      console.log('[CAD Measure] Punto 1 locked at:', snap.point);
      this.emitUpdate();
    } else {
      const dist = this.firstSelection.point.distanceTo(snap.point);
      if (dist < 0.1) {
        console.log('[CAD Measure] Clic en el mismo punto que P1 (< 0.1mm). Ignorado.');
        return;
      }

      this.secondSelection = snap;
      this.renderPointMarker(snap.point, COLOR_ITEM2, '2');
      console.log('[CAD Measure] Punto 2 locked at:', snap.point, 'Distance:', dist);
      this.computeDistanceMeasurement(this.firstSelection, this.secondSelection);
    }
  }

  /**
   * Computes True Planar Distance (Perpendicular thickness) or Face Angle
   */
  computePlanesMeasurement(sel1, sel2) {
    const P1 = sel1.point;
    const n1 = sel1.normal;
    const P2 = sel2.point;
    const n2 = sel2.normal;

    const directDist = P1.distanceTo(P2);
    const deltaX = Math.abs(P2.x - P1.x);
    const deltaY = Math.abs(P2.y - P1.y);
    const deltaZ = Math.abs(P2.z - P1.z);

    // Collinearity check between face normals (|n1 · n2| ~ 1)
    const dot = Math.max(-1, Math.min(1, n1.dot(n2)));
    const absDot = Math.abs(dot);
    const isParallel = absDot >= 0.985; // Angle <= ~10° tolerance

    // Vector connecting P1 to P2
    const v12 = new THREE.Vector3().subVectors(P2, P1);
    // Exact perpendicular signed distance along Plane 1 normal
    const signedDist = v12.dot(n1);
    const perpDist = Math.abs(signedDist);

    // Angle calculation in degrees
    const acuteAngleDeg = (Math.acos(absDot) * 180) / Math.PI;

    let measurement = null;

    if (isParallel) {
      const isCoplanar = perpDist < 0.05;
      measurement = {
        type: 'planes',
        title: isCoplanar ? 'Caras Coplanares' : 'Distancia entre Planos Paralelos',
        distance: perpDist,
        unit: 'mm',
        primaryValue: isCoplanar ? '0.00 mm (Coplanar)' : `${perpDist.toFixed(2)} mm`,
        secondaryValue: isCoplanar
          ? `Distancia en plano: ${directDist.toFixed(2)} mm | Paralelo (0.0°)`
          : `Distancia directa 3D: ${directDist.toFixed(2)} mm | Paralelos (0.0°)`,
        details: [
          { label: 'Espesor / Distancia Perpendicular', value: `${perpDist.toFixed(2)} mm` },
          { label: 'Distancia Directa 3D', value: `${directDist.toFixed(2)} mm` },
          { label: 'Relación Geométrica', value: isCoplanar ? 'Coplanares' : 'Paralelas (0.0°)' },
          { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
          { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
          { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
          { label: 'Normal Cara 1', value: `[${n1.x.toFixed(2)}, ${n1.y.toFixed(2)}, ${n1.z.toFixed(2)}]` },
          { label: 'Normal Cara 2', value: `[${n2.x.toFixed(2)}, ${n2.y.toFixed(2)}, ${n2.z.toFixed(2)}]` },
          { label: 'Punto Cara 1', value: formatVec3(P1) },
          { label: 'Punto Cara 2', value: formatVec3(P2) }
        ]
      };
      this.statusPrompt = isCoplanar
        ? `Caras coplanares (0.00 mm). Distancia en cara: ${directDist.toFixed(2)} mm. Haz clic para otra medición.`
        : `Espesor perpendicular: ${perpDist.toFixed(2)} mm. Haz clic de nuevo para otra medición.`;
    } else {
      measurement = {
        type: 'planes_angle',
        title: 'Ángulo entre Caras',
        distance: directDist,
        unit: '°',
        primaryValue: `${acuteAngleDeg.toFixed(1)}°`,
        secondaryValue: `Distancia 3D entre puntos: ${directDist.toFixed(2)} mm`,
        details: [
          { label: 'Ángulo Agudo', value: `${acuteAngleDeg.toFixed(1)}°` },
          { label: 'Ángulo Suplementario', value: `${(180 - acuteAngleDeg).toFixed(1)}°` },
          { label: 'Distancia Directa 3D', value: `${directDist.toFixed(2)} mm` },
          { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
          { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
          { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
          { label: 'Normal Cara 1', value: `[${n1.x.toFixed(2)}, ${n1.y.toFixed(2)}, ${n1.z.toFixed(2)}]` },
          { label: 'Normal Cara 2', value: `[${n2.x.toFixed(2)}, ${n2.y.toFixed(2)}, ${n2.z.toFixed(2)}]` },
          { label: 'Punto Cara 1', value: formatVec3(P1) },
          { label: 'Punto Cara 2', value: formatVec3(P2) }
        ]
      };
      this.statusPrompt = `Ángulo entre caras: ${acuteAngleDeg.toFixed(1)}°. Haz clic de nuevo para otra medición.`;
    }

    const targetMeshes = [
      sel1.mesh || (sel1.rawHit && sel1.rawHit.object) || (sel1.faceData && sel1.faceData.mesh),
      sel2.mesh || (sel2.rawHit && sel2.rawHit.object) || (sel2.faceData && sel2.faceData.mesh)
    ].filter(Boolean);
    const targetPoints = [P1, P2].filter(Boolean);
    const targetFaces = [sel1.faceData, sel2.faceData].filter(Boolean);
    if (measurement) {
      measurement.targetMeshes = targetMeshes;
      measurement.targetPoints = targetPoints;
      measurement.targetFaces = targetFaces;
      measurement.face1 = sel1.faceData;
      measurement.face2 = sel2.faceData;
      measurement.signedDist = signedDist;
      measurement.isParallel = isParallel;
      measurement.perpDist = perpDist;
      measurement.directDist = directDist;
      measurement.acuteAngleDeg = acuteAngleDeg;
      measurement.P1 = P1.clone();
      measurement.P2 = P2.clone();
      measurement.n1 = n1.clone();
      measurement.n2 = n2.clone();
    }

    this.currentMeasurement = measurement;
    this.renderPlanesDimensionVisual(P1, n1, P2, n2, isParallel, perpDist, directDist, acuteAngleDeg, signedDist, sel1.faceData, sel2.faceData);
    this.emitUpdate();
  }

  /**
   * Single cylinder/hole measurement details
   */
  computeSingleCylinderMeasurement(cylData) {
    const plane = (this.viewer && this.viewer.sectionActive) ? this.viewer.sectionPlane : null;
    const centerPoint = this.findVisibleCylinderAnchor(cylData, plane) || cylData.topCenter || cylData.rimCenter || cylData.center || cylData.hitPoint;
    this.currentMeasurement = {
      type: 'cylinder_single',
      title: cylData.label || 'Orificio Cilíndrico',
      distance: cylData.diameter,
      unit: 'mm',
      primaryValue: `Ø ${cylData.diameter.toFixed(2)} mm`,
      secondaryValue: `Radio: ${cylData.radius.toFixed(2)} mm${cylData.depth > 0.05 ? ` | Profundidad: ${cylData.depth.toFixed(2)} mm` : ''}`,
      targetMeshes: [cylData.mesh].filter(Boolean),
      targetPoints: centerPoint ? [centerPoint.clone()] : [],
      cylData: cylData,
      details: [
        { label: 'Diámetro (Ø)', value: `Ø ${cylData.diameter.toFixed(2)} mm` },
        { label: 'Radio (R)', value: `${cylData.radius.toFixed(2)} mm` },
        { label: 'Profundidad / Longitud', value: cylData.depth > 0.05 ? `${cylData.depth.toFixed(2)} mm` : '0.00 mm (Plano)' },
        { label: 'Tipo Geométrico', value: cylData.isCutCircle ? 'Círculo de Sección (Corte)' : (cylData.isHole ? 'Orificio Interior (Bore/Hole)' : 'Cilindro Exterior (Pin/Shaft)') },
        { label: 'Centro 3D (Borde)', value: formatVec3(centerPoint) },
        { label: 'Eje 3D', value: `[${cylData.axis.x.toFixed(2)}, ${cylData.axis.y.toFixed(2)}, ${cylData.axis.z.toFixed(2)}]` },
        { label: 'Facetas interpoladas', value: `${cylData.trianglesCount} triángulos` }
      ]
    };

    this.badges = [{
      id: 'measure-main',
      worldPos: centerPoint.clone(),
      text: `Ø ${cylData.diameter.toFixed(2)} mm`,
      targetCylinders: [cylData],
      screenX: 0,
      screenY: 0,
      visible: false
    }];

    this.statusPrompt = `${cylData.label} 1 fijado (Ø ${cylData.diameter.toFixed(2)} mm). Haz clic en otro elemento para medir relación...`;
    this.emitUpdate();
  }

  /**
   * Single straight edge / line measurement details
   */
  computeSingleEdgeMeasurement(edgeData) {
    const p1 = edgeData.p1;
    const p2 = edgeData.p2;
    const deltaX = Math.abs(p2.x - p1.x);
    const deltaY = Math.abs(p2.y - p1.y);
    const deltaZ = Math.abs(p2.z - p1.z);
    const dir = edgeData.direction;

    let orientationText = `Vector [${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)}]`;
    if (Math.abs(dir.x) > 0.998) orientationText = 'Paralela al Eje X';
    else if (Math.abs(dir.y) > 0.998) orientationText = 'Paralela al Eje Y';
    else if (Math.abs(dir.z) > 0.998) orientationText = 'Paralela al Eje Z';

    const isCut = !!edgeData.isCutEdge;

    this.currentMeasurement = {
      type: isCut ? 'edge_cut_single' : 'edge_single',
      title: isCut ? 'Longitud de Arista de Sección / Corte' : 'Longitud de Arista / Línea',
      distance: edgeData.length,
      unit: 'mm',
      primaryValue: `${edgeData.length.toFixed(2)} mm`,
      secondaryValue: `ΔX: ${deltaX.toFixed(1)} | ΔY: ${deltaY.toFixed(1)} | ΔZ: ${deltaZ.toFixed(1)} mm`,
      targetMeshes: [edgeData.mesh].filter(Boolean),
      targetPoints: [edgeData.p1, edgeData.p2].filter(Boolean),
      details: [
        { label: isCut ? 'Longitud de Arista de Corte' : 'Longitud de Arista', value: `${edgeData.length.toFixed(2)} mm` },
        { label: 'Tipo de Elemento', value: isCut ? 'Arista de Corte Dinámica (Sección Activa)' : 'Arista CAD' },
        { label: 'Orientación', value: orientationText },
        { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
        { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
        { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
        { label: 'Punto Inicial (P1)', value: formatVec3(p1) },
        { label: 'Punto Final (P2)', value: formatVec3(p2) },
        { label: 'Punto Medio', value: formatVec3(edgeData.midpoint) },
        { label: 'Vector Director', value: `[${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)}]` }
      ]
    };

    this.badges = [{
      id: 'measure-main',
      worldPos: edgeData.midpoint.clone(),
      text: `${edgeData.length.toFixed(2)} mm`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];

    this.statusPrompt = isCut
      ? `Arista de corte 1 fijada (${edgeData.length.toFixed(2)} mm). Haz clic en otra arista para medir espesor o distancia...`
      : `Arista 1 fijada (${edgeData.length.toFixed(2)} mm). Haz clic en una segunda arista, cara o punto para medir...`;
    this.emitUpdate();
  }

  /**
   * Computes relationship between two CAD straight lines / edges:
   * Parallel distance or Angle & 3D minimum distance
   */
  computeLinesMeasurement(edge1, edge2) {
    const L1 = edge1.length;
    const L2 = edge2.length;
    const u1 = edge1.direction;
    const u2 = edge2.direction;

    const dot = Math.max(-1, Math.min(1, u1.dot(u2)));
    const absDot = Math.abs(dot);
    const isParallel = absDot >= 0.998; // Angle <= ~3.6°

    const deltaX = Math.abs(edge2.midpoint.x - edge1.midpoint.x);
    const deltaY = Math.abs(edge2.midpoint.y - edge1.midpoint.y);
    const deltaZ = Math.abs(edge2.midpoint.z - edge1.midpoint.z);

    if (isParallel) {
      const v = new THREE.Vector3().subVectors(edge1.midpoint, edge2.p1);
      const perpVec = v.clone().sub(u2.clone().multiplyScalar(v.dot(u2)));
      const perpDist = perpVec.length();
      const isCollinear = perpDist < 0.05;
      const bothCut = !!(edge1.isCutEdge && edge2.isCutEdge);
      const hasCut = !!(edge1.isCutEdge || edge2.isCutEdge);

      const segRes = closestPointsBetweenSegments(edge1.p1, edge1.p2, edge2.p1, edge2.p2);

      let title = isCollinear ? 'Aristas Colineales' : 'Distancia entre Aristas Paralelas';
      if (bothCut) {
        title = isCollinear ? 'Aristas de Corte Colineales' : 'Espesor / Distancia entre Aristas de Corte';
      } else if (hasCut) {
        title = isCollinear ? 'Aristas Colineales' : 'Distancia entre Arista y Corte de Sección';
      }

      this.currentMeasurement = {
        type: 'lines_parallel',
        title: title,
        distance: perpDist,
        unit: 'mm',
        primaryValue: isCollinear ? '0.00 mm (Colineales)' : `${perpDist.toFixed(2)} mm`,
        secondaryValue: isCollinear
          ? `Aristas en la misma línea | Longitudes: ${L1.toFixed(2)} mm y ${L2.toFixed(2)} mm`
          : `${bothCut ? 'Espesor / separación' : 'Distancia perpendicular'}: ${perpDist.toFixed(2)} mm | Paralelas (0.0°)`,
        targetMeshes: [edge1.mesh, edge2.mesh].filter(Boolean),
        targetPoints: [edge1.midpoint, edge2.midpoint].filter(Boolean),
        details: [
          { label: bothCut ? 'Espesor / Distancia Perpendicular' : 'Distancia Perpendicular', value: `${perpDist.toFixed(2)} mm` },
          { label: 'Distancia Mínima entre Segmentos', value: `${segRes.dist.toFixed(2)} mm` },
          { label: 'Relación Geométrica', value: isCollinear ? 'Colineales (Misma línea)' : 'Paralelas (0.0°)' },
          { label: edge1.isCutEdge ? 'Longitud Arista de Corte 1' : 'Longitud Arista 1', value: `${L1.toFixed(2)} mm` },
          { label: edge2.isCutEdge ? 'Longitud Arista de Corte 2' : 'Longitud Arista 2', value: `${L2.toFixed(2)} mm` },
          { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
          { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
          { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
          { label: 'Punto Medio Arista 1', value: formatVec3(edge1.midpoint) },
          { label: 'Punto Medio Arista 2', value: formatVec3(edge2.midpoint) }
        ]
      };

      this.statusPrompt = isCollinear
        ? `Aristas colineales (0.00 mm). Haz clic para otra medición.`
        : `${bothCut ? 'Espesor entre cortes' : 'Distancia entre aristas paralelas'}: ${perpDist.toFixed(2)} mm. Haz clic para otra medición.`;

      this.renderLinesDimensionVisual(edge1, edge2, true, perpDist, segRes.dist, 0);
    } else {
      const angleRad = Math.acos(absDot);
      const angleDeg = (angleRad * 180.0) / Math.PI;

      const segRes = closestPointsBetweenSegments(edge1.p1, edge1.p2, edge2.p1, edge2.p2);
      const isIntersecting = segRes.dist < 0.1;

      this.currentMeasurement = {
        type: 'lines_angle',
        title: isIntersecting ? 'Ángulo entre Aristas Secantes' : 'Ángulo y Distancia entre Aristas',
        distance: angleDeg,
        unit: '°',
        primaryValue: `${angleDeg.toFixed(1)}°`,
        secondaryValue: isIntersecting
          ? `Intersección directa en 3D | Longitudes: ${L1.toFixed(2)} mm y ${L2.toFixed(2)} mm`
          : `Distancia mínima entre aristas: ${segRes.dist.toFixed(2)} mm`,
        targetMeshes: [edge1.mesh, edge2.mesh].filter(Boolean),
        targetPoints: [edge1.midpoint, edge2.midpoint].filter(Boolean),
        details: [
          { label: 'Ángulo entre Aristas', value: `${angleDeg.toFixed(1)}°` },
          { label: 'Ángulo Suplementario', value: `${(180 - angleDeg).toFixed(1)}°` },
          { label: 'Distancia Mínima 3D', value: isIntersecting ? '0.00 mm (Se tocan)' : `${segRes.dist.toFixed(2)} mm` },
          { label: 'Longitud Arista 1', value: `${L1.toFixed(2)} mm` },
          { label: 'Longitud Arista 2', value: `${L2.toFixed(2)} mm` },
          { label: 'Punto más Cercano Arista 1', value: formatVec3(segRes.pt1) },
          { label: 'Punto más Cercano Arista 2', value: formatVec3(segRes.pt2) }
        ]
      };

      this.statusPrompt = isIntersecting
        ? `Ángulo entre aristas: ${angleDeg.toFixed(1)}°. Haz clic para otra medición.`
        : `Ángulo: ${angleDeg.toFixed(1)}° (Distancia mín: ${segRes.dist.toFixed(2)} mm). Haz clic para otra medición.`;

      this.renderLinesDimensionVisual(edge1, edge2, false, 0, segRes.dist, angleDeg);
    }

    this.emitUpdate();
  }

  /**
   * Computes relationship between a straight edge and a planar face:
   * Perpendicular distance if parallel, or angle with face plane
   */
  computeLineAndPlaneMeasurement(edgeData, faceData) {
    const P_face = faceData.hitPoint || faceData.point;
    const n = faceData.normal;
    const u = edgeData.direction;
    const dot = Math.abs(u.dot(n));

    const isParallelToFace = dot < 0.02; // angle with face plane < ~1.1 deg
    const deltaX = Math.abs(edgeData.midpoint.x - P_face.x);
    const deltaY = Math.abs(edgeData.midpoint.y - P_face.y);
    const deltaZ = Math.abs(edgeData.midpoint.z - P_face.z);

    if (isParallelToFace) {
      const v = new THREE.Vector3().subVectors(edgeData.midpoint, P_face);
      const perpDist = Math.abs(v.dot(n));
      const isCoplanar = perpDist < 0.05;

      this.currentMeasurement = {
        type: 'line_plane',
        title: isCoplanar ? 'Arista en la Cara (Coplanar)' : 'Distancia entre Arista y Cara Paralela',
        distance: perpDist,
        unit: 'mm',
        primaryValue: isCoplanar ? '0.00 mm (Coplanar)' : `${perpDist.toFixed(2)} mm`,
        secondaryValue: `Longitud arista: ${edgeData.length.toFixed(2)} mm | Paralela a la cara (0.0°)`,
        targetMeshes: [edgeData.mesh, faceData.mesh].filter(Boolean),
        targetPoints: [edgeData.midpoint, P_face].filter(Boolean),
        details: [
          { label: 'Distancia Perpendicular', value: `${perpDist.toFixed(2)} mm` },
          { label: 'Longitud de Arista', value: `${edgeData.length.toFixed(2)} mm` },
          { label: 'Relación Geométrica', value: isCoplanar ? 'Arista contenida en el plano' : 'Paralela a la cara' },
          { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
          { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
          { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
          { label: 'Normal de Cara', value: `[${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}]` },
          { label: 'Punto Medio Arista', value: formatVec3(edgeData.midpoint) }
        ]
      };

      this.visualsGroup.clear();
      const group = new THREE.Group();
      const signedDist = v.dot(n);
      const projOnPlane = edgeData.midpoint.clone().sub(n.clone().multiplyScalar(signedDist));
      if (perpDist >= 0.05) {
        group.add(createThickLineMesh(edgeData.midpoint, projOnPlane, 0.5, this.getDimensionColor(), !this.xray, true));
      }
      this.visualsGroup.add(this.applySectionClipping(group));

      this.badges = [{
        id: 'measure-main',
        worldPos: edgeData.midpoint.clone().add(projOnPlane).multiplyScalar(0.5),
        text: `⟂ ${perpDist.toFixed(2)} mm`,
        screenX: 0,
        screenY: 0,
        visible: false
      }];

      this.statusPrompt = `Distancia perpendicular entre arista y cara: ${perpDist.toFixed(2)} mm. Haz clic para otra medición.`;
    } else {
      const angleRad = Math.asin(Math.min(1.0, dot));
      const angleDeg = (angleRad * 180.0) / Math.PI;

      this.currentMeasurement = {
        type: 'line_plane_angle',
        title: 'Ángulo entre Arista y Cara',
        distance: angleDeg,
        unit: '°',
        primaryValue: `${angleDeg.toFixed(1)}°`,
        secondaryValue: `Longitud arista: ${edgeData.length.toFixed(2)} mm`,
        targetMeshes: [edgeData.mesh, faceData.mesh].filter(Boolean),
        targetPoints: [edgeData.midpoint, P_face].filter(Boolean),
        details: [
          { label: 'Ángulo con la Superficie', value: `${angleDeg.toFixed(1)}°` },
          { label: 'Ángulo con la Normal', value: `${(90 - angleDeg).toFixed(1)}°` },
          { label: 'Longitud de Arista', value: `${edgeData.length.toFixed(2)} mm` },
          { label: 'Normal de Cara', value: `[${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}]` },
          { label: 'Punto Medio Arista', value: formatVec3(edgeData.midpoint) }
        ]
      };

      this.visualsGroup.clear();
      const mid = edgeData.midpoint;
      this.badges = [{
        id: 'measure-main',
        worldPos: mid.clone(),
        text: `∠ ${angleDeg.toFixed(1)}°`,
        screenX: 0,
        screenY: 0,
        visible: false
      }];

      this.statusPrompt = `Ángulo entre arista y cara: ${angleDeg.toFixed(1)}°. Haz clic para otra medición.`;
    }

    this.emitUpdate();
  }

  /**
   * Distance from 3D Point to CAD straight edge
   */
  computeLineAndPointMeasurement(edgeData, point) {
    const proj = new THREE.Vector3();
    const dist = distancePointToSegment(point, edgeData.p1, edgeData.p2, proj);
    const deltaX = Math.abs(point.x - proj.x);
    const deltaY = Math.abs(point.y - proj.y);
    const deltaZ = Math.abs(point.z - proj.z);

    const ptMesh = (this.firstSelection?.mesh || this.secondSelection?.mesh);
    this.currentMeasurement = {
      type: 'line_point',
      title: 'Distancia de Punto a Arista',
      distance: dist,
      unit: 'mm',
      primaryValue: `${dist.toFixed(2)} mm`,
      secondaryValue: `Longitud arista: ${edgeData.length.toFixed(2)} mm`,
      targetMeshes: [edgeData.mesh, ptMesh].filter(Boolean),
      targetPoints: [edgeData.midpoint, point].filter(Boolean),
      details: [
        { label: 'Distancia Perpendicular', value: `${dist.toFixed(2)} mm` },
        { label: 'Longitud de Arista', value: `${edgeData.length.toFixed(2)} mm` },
        { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
        { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
        { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
        { label: 'Punto Proyectado en Arista', value: formatVec3(proj) },
        { label: 'Punto Seleccionado', value: formatVec3(point) }
      ]
    };

    this.visualsGroup.clear();
    const group = new THREE.Group();
    if (dist >= 0.05) {
      group.add(createThickLineMesh(point, proj, 0.5, this.getDimensionColor(), !this.xray, true));
    }
    this.visualsGroup.add(this.applySectionClipping(group));

    const mid = new THREE.Vector3().addVectors(point, proj).multiplyScalar(0.5);
    this.badges = [{
      id: 'measure-main',
      worldPos: mid.clone(),
      text: `${dist.toFixed(2)} mm`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];

    this.statusPrompt = `Distancia de punto a arista: ${dist.toFixed(2)} mm. Haz clic para otra medición.`;
    this.emitUpdate();
  }

  /**
   * Relationship between straight edge and cylinder
   */
  computeLineAndCylinderMeasurement(edgeData, cylData) {
    const u = edgeData.direction;
    const a = cylData.axis;
    const dot = Math.abs(u.dot(a));
    const isParallel = dot > 0.998;

    const v = new THREE.Vector3().subVectors(edgeData.midpoint, cylData.center);
    const perpVec = v.clone().sub(a.clone().multiplyScalar(v.dot(a)));
    const axisDist = perpVec.length();
    const surfDist = Math.max(0, axisDist - cylData.radius);

    this.currentMeasurement = {
      type: 'line_cylinder',
      title: isParallel ? 'Distancia entre Arista y Cilindro Paralelo' : 'Distancia y Ángulo entre Arista y Cilindro',
      distance: axisDist,
      unit: 'mm',
      primaryValue: `${axisDist.toFixed(2)} mm (al eje)`,
      secondaryValue: `Distancia a la pared: ${surfDist.toFixed(2)} mm | Ø ${cylData.diameter.toFixed(2)} mm`,
      targetMeshes: [edgeData.mesh, cylData.mesh].filter(Boolean),
      targetPoints: [edgeData.midpoint, cylData.center || cylData.topCenter].filter(Boolean),
      details: [
        { label: 'Distancia al Eje Cilíndrico', value: `${axisDist.toFixed(2)} mm` },
        { label: 'Distancia a la Superficie / Pared', value: `${surfDist.toFixed(2)} mm` },
        { label: 'Diámetro Cilindro', value: `Ø ${cylData.diameter.toFixed(2)} mm` },
        { label: 'Longitud de Arista', value: `${edgeData.length.toFixed(2)} mm` },
        { label: 'Relación de Ejes', value: isParallel ? 'Paralelos (0.0°)' : `${((Math.acos(Math.min(1.0, dot)) * 180) / Math.PI).toFixed(1)}°` }
      ]
    };

    this.visualsGroup.clear();
    const group = new THREE.Group();
    const projOnAxis = cylData.center.clone().addScaledVector(a, v.dot(a));
    if (axisDist >= 0.05) {
      group.add(createThickLineMesh(edgeData.midpoint, projOnAxis, 0.5, this.getDimensionColor(), !this.xray, true));
    }
    this.visualsGroup.add(this.applySectionClipping(group));

    const mid = new THREE.Vector3().addVectors(edgeData.midpoint, projOnAxis).multiplyScalar(0.5);
    this.badges = [{
      id: 'measure-main',
      worldPos: mid.clone(),
      text: `${axisDist.toFixed(2)} mm`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];

    this.statusPrompt = `Distancia entre arista y cilindro: ${axisDist.toFixed(2)} mm. Haz clic para otra medición.`;
    this.emitUpdate();
  }

  /**
   * Computes relationship between a 3D Point and a Planar Face:
   * Perpendicular distance to the plane, direct distance to face center, projected point
   */
  computePointAndPlaneMeasurement(point, faceData) {
    const P_face = faceData.hitPoint || faceData.point || faceData.center;
    const n = faceData.normal;
    const v = new THREE.Vector3().subVectors(point, P_face);
    const signedDist = v.dot(n);
    const perpDist = Math.abs(signedDist);
    const projOnPlane = point.clone().sub(n.clone().multiplyScalar(signedDist));
    const directDist = point.distanceTo(P_face);
    const isCoplanar = perpDist < 0.05;

    const deltaX = Math.abs(point.x - projOnPlane.x);
    const deltaY = Math.abs(point.y - projOnPlane.y);
    const deltaZ = Math.abs(point.z - projOnPlane.z);

    const ptMesh = (this.firstSelection?.mesh || this.secondSelection?.mesh);
    this.currentMeasurement = {
      type: 'point_plane',
      title: isCoplanar ? 'Punto en el Plano (Coplanar)' : 'Distancia de Punto a Plano',
      distance: perpDist,
      unit: 'mm',
      primaryValue: isCoplanar ? '0.00 mm (Coplanar)' : `${perpDist.toFixed(2)} mm`,
      secondaryValue: isCoplanar ? 'El punto está sobre la cara' : `Directa a centro: ${directDist.toFixed(2)} mm`,
      targetMeshes: [faceData.mesh, ptMesh].filter(Boolean),
      targetPoints: [point, P_face].filter(Boolean),
      details: [
        { label: 'Distancia Perpendicular', value: `${perpDist.toFixed(2)} mm` },
        { label: 'Distancia Directa al Centro', value: `${directDist.toFixed(2)} mm` },
        { label: 'Relación Geométrica', value: isCoplanar ? 'Punto contenido en el plano' : 'Punto fuera del plano' },
        { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
        { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
        { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
        { label: 'Punto Seleccionado', value: formatVec3(point) },
        { label: 'Punto Proyectado en Plano', value: formatVec3(projOnPlane) },
        { label: 'Normal de Cara', value: `[${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}]` }
      ]
    };

    this.visualsGroup.clear();
    const group = new THREE.Group();
    if (perpDist >= 0.05) {
      group.add(createThickLineMesh(point, projOnPlane, 0.5, this.getDimensionColor(), !this.xray, true));
      const markerGeom = new THREE.SphereGeometry(0.5, 8, 8);
      const markerMat = new THREE.MeshBasicMaterial({ color: this.getDimensionColor(), depthTest: !this.xray });
      const landing = new THREE.Mesh(markerGeom, markerMat);
      landing.position.copy(projOnPlane);
      group.add(landing);
    }
    this.visualsGroup.add(this.applySectionClipping(group));

    const mid = perpDist >= 0.05
      ? new THREE.Vector3().addVectors(point, projOnPlane).multiplyScalar(0.5)
      : point.clone();

    this.badges = [{
      id: 'measure-main',
      worldPos: mid,
      text: isCoplanar ? '0.00 mm (Coplanar)' : `⟂ ${perpDist.toFixed(2)} mm`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];

    this.statusPrompt = isCoplanar
      ? 'El punto está en el plano. Haz clic para otra medición.'
      : `Distancia perpendicular al plano: ${perpDist.toFixed(2)} mm. Haz clic para otra medición.`;
    this.emitUpdate();
  }

  /**
   * Computes relationship between a 3D Point and a Cylinder / Hole:
   * Perpendicular distance to axis, distance to cylinder wall (gap / clearance)
   */
  computePointAndCylinderMeasurement(point, cylData) {
    const A = cylData.axis;
    const C = cylData.center;
    const v = new THREE.Vector3().subVectors(point, C);
    const t = v.dot(A);
    const projOnAxis = C.clone().addScaledVector(A, t);
    const axisDist = point.distanceTo(projOnAxis);
    const surfDist = Math.max(0, Math.abs(axisDist - cylData.radius));
    const isInside = axisDist < cylData.radius;

    const deltaX = Math.abs(point.x - projOnAxis.x);
    const deltaY = Math.abs(point.y - projOnAxis.y);
    const deltaZ = Math.abs(point.z - projOnAxis.z);

    const ptMesh = (this.firstSelection?.mesh || this.secondSelection?.mesh);
    this.currentMeasurement = {
      type: 'point_cylinder',
      title: 'Distancia de Punto a Cilindro / Orificio',
      distance: axisDist,
      unit: 'mm',
      primaryValue: `${axisDist.toFixed(2)} mm (al eje)`,
      secondaryValue: `A la pared: ${surfDist.toFixed(2)} mm (${isInside ? 'Interior' : 'Exterior'}) | Ø ${cylData.diameter.toFixed(2)} mm`,
      targetMeshes: [cylData.mesh, ptMesh].filter(Boolean),
      targetPoints: [point, cylData.center || cylData.topCenter].filter(Boolean),
      details: [
        { label: 'Distancia Perpendicular al Eje', value: `${axisDist.toFixed(2)} mm` },
        { label: 'Distancia a la Superficie / Pared', value: `${surfDist.toFixed(2)} mm` },
        { label: 'Posición Relativa', value: isInside ? 'Interior del cilindro' : 'Exterior del cilindro' },
        { label: 'Diámetro Cilindro', value: `Ø ${cylData.diameter.toFixed(2)} mm` },
        { label: 'Radio Cilindro', value: `${cylData.radius.toFixed(2)} mm` },
        { label: 'Componente ΔX', value: `${deltaX.toFixed(2)} mm` },
        { label: 'Componente ΔY', value: `${deltaY.toFixed(2)} mm` },
        { label: 'Componente ΔZ', value: `${deltaZ.toFixed(2)} mm` },
        { label: 'Punto Seleccionado', value: formatVec3(point) },
        { label: 'Punto Proyectado en Eje', value: formatVec3(projOnAxis) },
        { label: 'Centro 3D Cilindro', value: formatVec3(C) }
      ]
    };

    this.visualsGroup.clear();
    const group = new THREE.Group();
    if (axisDist >= 0.05) {
      group.add(createThickLineMesh(point, projOnAxis, 0.5, this.getDimensionColor(), !this.xray, true));
      const axisMarkerGeom = new THREE.SphereGeometry(0.5, 8, 8);
      const axisMarkerMat = new THREE.MeshBasicMaterial({ color: this.getDimensionColor(), depthTest: !this.xray });
      const landing = new THREE.Mesh(axisMarkerGeom, axisMarkerMat);
      landing.position.copy(projOnAxis);
      group.add(landing);
    }
    this.visualsGroup.add(this.applySectionClipping(group));

    const mid = axisDist >= 0.05
      ? new THREE.Vector3().addVectors(point, projOnAxis).multiplyScalar(0.5)
      : point.clone();

    this.badges = [{
      id: 'measure-main',
      worldPos: mid,
      text: `${axisDist.toFixed(2)} mm`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];

    this.statusPrompt = `Distancia de punto a eje: ${axisDist.toFixed(2)} mm (pared: ${surfDist.toFixed(2)} mm). Haz clic para otra medición.`;
    this.emitUpdate();
  }

  /**
   * Computes relationship between a Planar Face and a Cylinder:
   * Perpendicular distance if cylinder axis is parallel to face, or angle between axis and plane
   */
  computePlaneAndCylinderMeasurement(faceData, cylData) {
    const P_face = faceData.hitPoint || faceData.point || faceData.center;
    const n = faceData.normal;
    const a = cylData.axis;
    const dot = Math.abs(a.dot(n));
    const isParallelToFace = dot < 0.03; // Axis is perpendicular to plane normal -> axis is parallel to face

    if (isParallelToFace) {
      const v = new THREE.Vector3().subVectors(cylData.center, P_face);
      const signedDist = v.dot(n);
      const axisDist = Math.abs(signedDist);
      const wallDist = Math.max(0, axisDist - cylData.radius);
      const projOnPlane = cylData.center.clone().sub(n.clone().multiplyScalar(signedDist));

      this.currentMeasurement = {
        type: 'plane_cylinder_distance',
        title: 'Distancia entre Eje Cilíndrico y Cara Paralela',
        distance: axisDist,
        unit: 'mm',
        primaryValue: `${axisDist.toFixed(2)} mm (al eje)`,
        secondaryValue: `Pared a cara: ${wallDist.toFixed(2)} mm | Ø ${cylData.diameter.toFixed(2)} mm | Eje paralelo (0.0°)`,
        targetMeshes: [faceData.mesh, cylData.mesh].filter(Boolean),
        targetPoints: [P_face, cylData.center || cylData.topCenter].filter(Boolean),
        details: [
          { label: 'Distancia Eje a Cara', value: `${axisDist.toFixed(2)} mm` },
          { label: 'Espesor Mínimo (Pared a Cara)', value: `${wallDist.toFixed(2)} mm` },
          { label: 'Diámetro Cilindro', value: `Ø ${cylData.diameter.toFixed(2)} mm` },
          { label: 'Radio Cilindro', value: `${cylData.radius.toFixed(2)} mm` },
          { label: 'Relación Geométrica', value: 'Eje cilíndrico paralelo a la cara (0.0°)' },
          { label: 'Normal de Cara', value: `[${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}]` },
          { label: 'Eje Cilíndrico', value: `[${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)}]` },
          { label: 'Centro Cilindro', value: formatVec3(cylData.center) }
        ]
      };

      this.visualsGroup.clear();
      const group = new THREE.Group();
      if (axisDist >= 0.05) {
        group.add(createThickLineMesh(cylData.center, projOnPlane, 0.5, this.getDimensionColor(), !this.xray, true));
      }
      this.visualsGroup.add(this.applySectionClipping(group));

      const mid = new THREE.Vector3().addVectors(cylData.center, projOnPlane).multiplyScalar(0.5);
      this.badges = [{
        id: 'measure-main',
        worldPos: mid,
        text: `⟂ ${axisDist.toFixed(2)} mm`,
        screenX: 0,
        screenY: 0,
        visible: false
      }];

      this.statusPrompt = `Distancia eje-cara: ${axisDist.toFixed(2)} mm (pared: ${wallDist.toFixed(2)} mm). Haz clic para otra medición.`;
    } else {
      const elevationRad = Math.asin(Math.min(1.0, dot));
      const angleDeg = (elevationRad * 180.0) / Math.PI;
      const isPerp = Math.abs(angleDeg - 90.0) < 1.5;

      this.currentMeasurement = {
        type: 'plane_cylinder_angle',
        title: isPerp ? 'Cilindro Perpendicular a la Cara (90°)' : 'Ángulo entre Cilindro y Cara',
        distance: angleDeg,
        unit: '°',
        primaryValue: isPerp ? '90.0° (Perpendicular)' : `${angleDeg.toFixed(1)}°`,
        secondaryValue: `Ø ${cylData.diameter.toFixed(2)} mm | Ángulo con la normal: ${(90 - angleDeg).toFixed(1)}°`,
        targetMeshes: [faceData.mesh, cylData.mesh].filter(Boolean),
        targetPoints: [P_face, cylData.center || cylData.topCenter].filter(Boolean),
        details: [
          { label: 'Ángulo con la Superficie', value: `${angleDeg.toFixed(1)}°` },
          { label: 'Ángulo con la Normal', value: `${(90 - angleDeg).toFixed(1)}°` },
          { label: 'Relación Geométrica', value: isPerp ? 'Eje perpendicular a la cara (orificio pasante)' : 'Eje inclinado respecto a la cara' },
          { label: 'Diámetro Cilindro', value: `Ø ${cylData.diameter.toFixed(2)} mm` },
          { label: 'Normal de Cara', value: `[${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)}]` },
          { label: 'Centro Cilindro', value: formatVec3(cylData.center) }
        ]
      };

      this.visualsGroup.clear();
      this.badges = [{
        id: 'measure-main',
        worldPos: cylData.center.clone(),
        text: `∠ ${angleDeg.toFixed(1)}°`,
        screenX: 0,
        screenY: 0,
        visible: false
      }];

      this.statusPrompt = `Ángulo cilindro-cara: ${angleDeg.toFixed(1)}°. Haz clic para otra medición.`;
    }

    this.emitUpdate();
  }

  /**
   * Visual 3D dimensions connecting two lines/edges
   */
  renderLinesDimensionVisual(edge1, edge2, isParallel, perpDist, minDist, angleDeg) {
    this.visualsGroup.clear();
    const group = new THREE.Group();

    if (isParallel) {
      const res = closestPointsBetweenSegments(edge1.p1, edge1.p2, edge2.p1, edge2.p2);
      let ptA = res.pt1;
      let ptB = res.pt2;

      const u2 = edge2.direction;
      const v = new THREE.Vector3().subVectors(edge1.midpoint, edge2.p1);
      const projOnLine2 = edge2.p1.clone().addScaledVector(u2, v.dot(u2));
      const t = u2.dot(new THREE.Vector3().subVectors(projOnLine2, edge2.p1)) / (edge2.length || 1);
      if (t >= 0 && t <= 1) {
        ptA = edge1.midpoint.clone();
        ptB = projOnLine2;
      }

      if (perpDist >= 0.05) {
        const dimRod = createThickLineMesh(ptA, ptB, 0.5, this.getDimensionColor(), !this.xray, true);
        group.add(dimRod);

        const markerGeom = new THREE.SphereGeometry(0.8, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: this.getDimensionColor(), depthTest: !this.xray });
        const mA = new THREE.Mesh(markerGeom, markerMat);
        mA.position.copy(ptA);
        mA.userData.isDimensionLine = true;
        group.add(mA);

        const mB = new THREE.Mesh(markerGeom, markerMat);
        mB.position.copy(ptB);
        mB.userData.isDimensionLine = true;
        group.add(mB);

        const mid = new THREE.Vector3().addVectors(ptA, ptB).multiplyScalar(0.5);
        this.badges = [{
          id: 'measure-main',
          worldPos: mid.clone(),
          text: `⟂ ${perpDist.toFixed(2)} mm`,
          screenX: 0,
          screenY: 0,
          visible: false
        }];
      } else {
        this.badges = [{
          id: 'measure-main',
          worldPos: edge1.midpoint.clone(),
          text: `Colineales (0.00 mm)`,
          screenX: 0,
          screenY: 0,
          visible: false
        }];
      }
    } else {
      const res = closestPointsBetweenSegments(edge1.p1, edge1.p2, edge2.p1, edge2.p2);
      if (res.dist > 0.05) {
        const dimRod = createThickLineMesh(res.pt1, res.pt2, 0.5, this.getDimensionColor(), !this.xray, true);
        group.add(dimRod);

        const markerGeom = new THREE.SphereGeometry(0.8, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: this.getDimensionColor(), depthTest: !this.xray });
        const mA = new THREE.Mesh(markerGeom, markerMat);
        mA.position.copy(res.pt1);
        mA.userData.isDimensionLine = true;
        group.add(mA);

        const mB = new THREE.Mesh(markerGeom, markerMat);
        mB.position.copy(res.pt2);
        mB.userData.isDimensionLine = true;
        group.add(mB);
      }

      const mid = new THREE.Vector3().addVectors(res.pt1, res.pt2).multiplyScalar(0.5);
      this.badges = [{
        id: 'measure-main',
        worldPos: mid.clone(),
        text: `∠ ${angleDeg.toFixed(1)}°${res.dist > 0.1 ? ` | ${res.dist.toFixed(2)} mm` : ''}`,
        screenX: 0,
        screenY: 0,
        visible: false
      }];
    }

    this.visualsGroup.add(this.applySectionClipping(group));
  }

  /**
   * Computes 3D Point-to-Point Distance and delta components
   */
  computeDistanceMeasurement(sel1, sel2) {
    const P1 = sel1.point;
    const P2 = sel2.point;
    const directDistance = P1.distanceTo(P2);
    const deltaX = Math.abs(P2.x - P1.x);
    const deltaY = Math.abs(P2.y - P1.y);
    const deltaZ = Math.abs(P2.z - P1.z);

    const targetMeshes = [
      sel1.mesh || (sel1.rawHit && sel1.rawHit.object),
      sel2.mesh || (sel2.rawHit && sel2.rawHit.object)
    ].filter(Boolean);
    const targetPoints = [P1, P2].filter(Boolean);

    const measurement = {
      type: 'distance',
      title: 'Distancia 3D (Punto a Punto)',
      distance: directDistance,
      deltaX, deltaY, deltaZ,
      unit: 'mm',
      primaryValue: `${directDistance.toFixed(2)} mm`,
      secondaryValue: `ΔX: ${deltaX.toFixed(1)} | ΔY: ${deltaY.toFixed(1)} | ΔZ: ${deltaZ.toFixed(1)} mm`,
      targetMeshes,
      targetPoints,
      details: [
        { label: 'Distancia Total 3D', value: `${directDistance.toFixed(2)} mm` },
        { label: 'Componente ΔX (Ancho)', value: `${deltaX.toFixed(2)} mm` },
        { label: 'Componente ΔY (Profundidad)', value: `${deltaY.toFixed(2)} mm` },
        { label: 'Componente ΔZ (Altura)', value: `${deltaZ.toFixed(2)} mm` },
        { label: 'Punto 1', value: formatVec3(P1) },
        { label: 'Punto 2', value: formatVec3(P2) }
      ]
    };

    this.currentMeasurement = measurement;
    this.statusPrompt = `Medición: ${directDistance.toFixed(2)} mm. Haz clic de nuevo para otra medición.`;
    this.renderDimensionLine(P1, P2, `${directDistance.toFixed(2)} mm`);
    this.emitUpdate();
  }

  /**
   * Updates subtle live hover glow over whatever CAD feature (face or cylinder) is under the mouse cursor
   */
  updateHoverFace(snap) {
    if (!this.isActive) return;

    // Cyan if selecting Item 1, Amber if selecting Item 2
    const hoverColor = !this.firstSelection ? COLOR_ITEM1 : COLOR_ITEM2;

    // 0. If snap is a CAD Vertex / Corner
    if (snap.type === 'vertex') {
      this.clearHoverFace();
      this.snapMarker.visible = true;
      if (this.snapMarkerRing) {
        this.snapMarkerRing.visible = true;
        this.snapMarkerRing.position.copy(snap.point);
        if (this.camera) {
          this.snapMarkerRing.quaternion.copy(this.camera.quaternion);
        }
        const scale = Math.max(0.5, this.getSnapThreshold(snap.point) * 0.25);
        this.snapMarkerRing.scale.set(scale, scale, scale);
      }
      return;
    }

    if (this.snapMarkerRing) this.snapMarkerRing.visible = false;

    // 0.5 If snap is a Cut Circle (or contains cutCircle / cylData)
    const targetCutCircle = snap.cutCircle || (snap.edgeData && snap.edgeData.cutCircle);
    if (targetCutCircle) {
      if (
        this.currentHoverFaceData === targetCutCircle &&
        this.currentHoverMesh === targetCutCircle.mesh
      ) {
        return;
      }
      this.clearHoverFace();
      this.currentHoverMesh = targetCutCircle.mesh;
      this.currentHoverFaceData = targetCutCircle;
      this.snapMarker.visible = false;
      const hoverGroup = this.renderCylinderHighlight(targetCutCircle, hoverColor, true);
      this.hoverGroup.add(hoverGroup);
      this.statusPrompt = !this.firstSelection
        ? `Círculo de corte detectado (Ø ${targetCutCircle.diameter.toFixed(2)} mm). Clic para fijar como Elemento 1`
        : `Círculo de corte detectado (Ø ${targetCutCircle.diameter.toFixed(2)} mm). Clic para fijar como Elemento 2`;
      this.emitUpdate();
      return;
    }

    // 1. If snap already contains edgeData (e.g. section cut edge) and not in 'radius' mode
    if (this.mode !== 'radius' && snap.edgeData) {
      const edgeData = snap.edgeData;
      if (
        this.currentHoverEdgeData &&
        this.currentHoverEdgeData.p1.distanceTo(edgeData.p1) < 0.1 &&
        this.currentHoverEdgeData.p2.distanceTo(edgeData.p2) < 0.1
      ) {
        return;
      }
      this.clearHoverFace();
      this.currentHoverMesh = edgeData.mesh || null;
      this.currentHoverEdgeData = edgeData;
      this.snapMarker.visible = false;
      const hoverGroup = this.renderCADEdgeHighlight(edgeData, hoverColor, true);
      this.hoverGroup.add(hoverGroup);
      return;
    }

    const hit = snap.rawHit;
    if (!hit || !hit.object || !hit.object.isMesh || hit.faceIndex === undefined) {
      this.clearHoverFace();
      this.snapMarker.visible = true;
      return;
    }

    // 1. In 'lines' mode: prioritize straight edge detection
    if (this.mode === 'lines') {
      const edgeData = detectCADStraightEdge(hit.object, hit.faceIndex, snap.point, this.raycaster.ray.direction, 50.0);
      if (edgeData) {
        if (
          this.currentHoverMesh === hit.object &&
          this.currentHoverEdgeData &&
          this.currentHoverEdgeData.p1.distanceTo(edgeData.p1) < 0.1 &&
          this.currentHoverEdgeData.p2.distanceTo(edgeData.p2) < 0.1
        ) {
          return;
        }
        this.clearHoverFace();
        this.currentHoverMesh = hit.object;
        this.currentHoverEdgeData = edgeData;
        this.snapMarker.visible = false;
        const hoverGroup = this.renderCADEdgeHighlight(edgeData, hoverColor, true);
        this.hoverGroup.add(hoverGroup);
        return;
      } else {
        this.clearHoverFace();
        this.snapMarker.visible = true;
        return;
      }
    }

    // 2. In 'radius' mode: prioritize cylinder/circle detection
    if (this.mode === 'radius') {
      const cylData = detectCADCylinderOrCircle(hit.object, hit.faceIndex, snap.point, this.raycaster.ray.direction);
      if (cylData) {
        if (
          this.currentHoverMesh === hit.object &&
          this.currentHoverFaceData &&
          this.currentHoverFaceData.triangleIndicesSet &&
          this.currentHoverFaceData.triangleIndicesSet.has(hit.faceIndex)
        ) {
          return;
        }
        this.clearHoverFace();
        this.currentHoverMesh = hit.object;
        this.currentHoverFaceData = cylData;
        this.snapMarker.visible = false;
        const hoverGroup = this.renderCylinderHighlight(cylData, hoverColor, true);
        this.hoverGroup.add(hoverGroup);
        return;
      } else {
        this.clearHoverFace();
        this.snapMarker.visible = true;
        return;
      }
    }

    // 3. In 'smart' mode: check cylinder first, then straight edge within snap threshold, then planar face
    if (this.mode === 'smart') {
      const cylData = detectCADCylinderOrCircle(hit.object, hit.faceIndex, snap.point, this.raycaster.ray.direction);
      if (cylData) {
        if (
          this.currentHoverMesh === hit.object &&
          this.currentHoverFaceData &&
          this.currentHoverFaceData.triangleIndicesSet &&
          this.currentHoverFaceData.triangleIndicesSet.has(hit.faceIndex)
        ) {
          return;
        }
        this.clearHoverFace();
        this.currentHoverMesh = hit.object;
        this.currentHoverFaceData = cylData;
        this.snapMarker.visible = false;
        const hoverGroup = this.renderCylinderHighlight(cylData, hoverColor, true);
        this.hoverGroup.add(hoverGroup);
        return;
      }

      const snapThreshold = this.getSnapThreshold(snap.point);
      const edgeData = detectCADStraightEdge(hit.object, hit.faceIndex, snap.point, this.raycaster.ray.direction, snapThreshold);
      if (edgeData) {
        if (
          this.currentHoverMesh === hit.object &&
          this.currentHoverEdgeData &&
          this.currentHoverEdgeData.p1.distanceTo(edgeData.p1) < 0.1 &&
          this.currentHoverEdgeData.p2.distanceTo(edgeData.p2) < 0.1
        ) {
          return;
        }
        this.clearHoverFace();
        this.currentHoverMesh = hit.object;
        this.currentHoverEdgeData = edgeData;
        this.snapMarker.visible = false;
        const hoverGroup = this.renderCADEdgeHighlight(edgeData, hoverColor, true);
        this.hoverGroup.add(hoverGroup);
        return;
      }
    }

    // If cursor is already over the face that is currently hovered, do nothing
    if (
      this.currentHoverMesh === hit.object &&
      this.currentHoverFaceData &&
      this.currentHoverFaceData.triangleIndicesSet &&
      this.currentHoverFaceData.triangleIndicesSet.has(hit.faceIndex)
    ) {
      return;
    }

    // 4. Planar face detection (for 'planes' or 'smart')
    const faceData = extractCADPlanarFace(hit.object, hit.faceIndex, snap.point, this.raycaster.ray.direction);
    if (!faceData) {
      this.clearHoverFace();
      this.snapMarker.visible = true;
      return;
    }

    this.clearHoverFace();
    this.currentHoverMesh = hit.object;
    this.currentHoverFaceData = faceData;
    this.snapMarker.visible = false;

    const hoverGroup = this.renderCADFaceHighlight(faceData, hoverColor, true);
    this.hoverGroup.add(hoverGroup);
  }

  /**
   * Clears hover face highlight and disposes its resources
   */
  clearHoverFace() {
    this.currentHoverMesh = null;
    this.currentHoverFaceData = null;
    this.currentHoverEdgeData = null;
    while (this.hoverGroup.children.length > 0) {
      const child = this.hoverGroup.children[0];
      this.hoverGroup.remove(child);
      if (child.traverse) {
        child.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
    }
  }

  applySectionClipping(group) {
    if (!group) return group;
    const planes = (this.viewer && this.viewer.sectionActive && this.viewer.sectionPlane)
      ? [ this.viewer.sectionPlane ]
      : [];
    group.traverse(child => {
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => {
            m.clippingPlanes = planes;
            m.clipShadows = true;
          });
        } else {
          child.material.clippingPlanes = planes;
          child.material.clipShadows = true;
        }
      }
    });
    return group;
  }

  isFaceVisibleUnderPlane(faceData, plane) {
    return isFaceVisibleUnderPlane(faceData, plane);
  }

  isEdgeVisibleUnderPlane(edgeData, plane) {
    return isEdgeVisibleUnderPlane(edgeData, plane);
  }

  isCylinderVisibleUnderPlane(cylData, plane) {
    return isCylinderVisibleUnderPlane(cylData, plane);
  }

  findVisibleCylinderAnchor(cylData, plane) {
    return findVisibleCylinderAnchor(cylData, plane);
  }

  /**
   * Dynamically finds a visible anchor pair (Q2 on Plane 2, Q1 on Plane 1) when section cut is active.
   * If both original points (P2 and projP1) are visible (>= 0.05 mm), preserves them exactly.
   * If one or both are cut away, searches face sample points to anchor the dimension rod and badge
   * inside the visible remaining half-space.
   */
  findVisiblePlanesAnchor(P1, n1, P2, signedDist, face1, face2, plane) {
    const origProj = P2.clone().sub(n1.clone().multiplyScalar(signedDist));
    if (!plane) {
      return { Q2: P2.clone(), Q1: origProj };
    }

    const dP2 = plane.distanceToPoint(P2);
    const dProj = plane.distanceToPoint(origProj);
    // If original points are both comfortably visible, preserve them!
    if (dP2 >= 0.05 && dProj >= 0.05) {
      return { Q2: P2.clone(), Q1: origProj };
    }

    const M0 = new THREE.Vector3().addVectors(P1, P2).multiplyScalar(0.5);
    const pool2 = (face2 && face2.samplePoints && face2.samplePoints.length > 0) ? face2.samplePoints : [P2];
    const pool1 = (face1 && face1.samplePoints && face1.samplePoints.length > 0) ? face1.samplePoints : [P1];

    let bestPair = null;
    let bestScore = -Infinity;
    let fallbackPair = null;
    let fallbackMinDist = -Infinity;

    // Pool 2: Points on Face 2 projected along normal onto Plane 1
    for (let i = 0; i < pool2.length; i++) {
      const q2 = pool2[i];
      const d2 = plane.distanceToPoint(q2);
      const q1 = q2.clone().sub(n1.clone().multiplyScalar(signedDist));
      const d1 = plane.distanceToPoint(q1);

      const minD = Math.min(d1, d2);
      if (minD > fallbackMinDist) {
        fallbackMinDist = minD;
        fallbackPair = { Q2: q2.clone(), Q1: q1 };
      }

      if (d2 >= -0.005 && d1 >= -0.005) {
        const mid = new THREE.Vector3().addVectors(q1, q2).multiplyScalar(0.5);
        const distM0 = mid.distanceTo(M0);
        const score = Math.min(minD, 20.0) * 3.0 - distM0;
        if (score > bestScore) {
          bestScore = score;
          bestPair = { Q2: q2.clone(), Q1: q1 };
        }
      }
    }

    // Pool 1: Points on Face 1 projected along normal onto Plane 2
    for (let i = 0; i < pool1.length; i++) {
      const q1 = pool1[i];
      const d1 = plane.distanceToPoint(q1);
      const q2 = q1.clone().add(n1.clone().multiplyScalar(signedDist));
      const d2 = plane.distanceToPoint(q2);

      const minD = Math.min(d1, d2);
      if (minD > fallbackMinDist) {
        fallbackMinDist = minD;
        fallbackPair = { Q2: q2, Q1: q1.clone() };
      }

      if (d1 >= -0.005 && d2 >= -0.005) {
        const mid = new THREE.Vector3().addVectors(q1, q2).multiplyScalar(0.5);
        const distM0 = mid.distanceTo(M0);
        const score = Math.min(minD, 20.0) * 3.0 - distM0;
        if (score > bestScore) {
          bestScore = score;
          bestPair = { Q2: q2, Q1: q1.clone() };
        }
      }
    }

    if (bestPair) return bestPair;
    if (fallbackPair) return fallbackPair;
    return { Q2: P2.clone(), Q1: origProj };
  }

  updatePlanesDynamicAnchors() {
    const plane = (this.viewer && this.viewer.sectionActive) ? this.viewer.sectionPlane : null;

    // 1. Active draft measurement
    if (this.currentMeasurement && this.currentMeasurement.type === 'planes' && this.currentMeasurement.face1 && this.currentMeasurement.face2) {
      const cm = this.currentMeasurement;
      const { Q2, Q1 } = this.findVisiblePlanesAnchor(cm.P1, cm.n1, cm.P2, cm.signedDist, cm.face1, cm.face2, plane);
      const mid = new THREE.Vector3().addVectors(Q2, Q1).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(Q1, Q2);

      const rod = this.visualsGroup.getObjectByName('dimRod');
      if (rod) {
        rod.position.copy(mid);
        rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      }
      const mQ2 = this.visualsGroup.getObjectByName('markerQ2');
      if (mQ2) mQ2.position.copy(Q2);
      const mQ1 = this.visualsGroup.getObjectByName('markerQ1');
      if (mQ1) mQ1.position.copy(Q1);

      const extLine = this.visualsGroup.getObjectByName('extLine');
      if (extLine) {
        extLine.visible = (!plane || plane.distanceToPoint(cm.P1) >= -0.005);
      }

      if (this.badges && this.badges.length > 0) {
        for (let i = 0; i < this.badges.length; i++) {
          if (this.badges[i].id === 'measure-main') {
            this.badges[i].worldPos.copy(mid);
          }
        }
      }
    }

    // 1b. Active single cylinder measurement
    if (this.currentMeasurement && this.currentMeasurement.type === 'cylinder_single' && this.currentMeasurement.cylData) {
      const anchor = this.findVisibleCylinderAnchor(this.currentMeasurement.cylData, plane);
      if (anchor && this.badges && this.badges.length > 0) {
        for (let i = 0; i < this.badges.length; i++) {
          if (this.badges[i].id === 'measure-main') {
            this.badges[i].worldPos.copy(anchor);
          }
        }
      }
    }

    // 2. Saved measurements
    if (this.savedMeasurements && this.savedMeasurements.length > 0) {
      for (let i = 0; i < this.savedMeasurements.length; i++) {
        const sm = this.savedMeasurements[i];
        if (sm.data && sm.data.type === 'planes' && sm.face1 && sm.face2 && sm.group) {
          const { Q2, Q1 } = this.findVisiblePlanesAnchor(sm.P1, sm.n1, sm.P2, sm.signedDist, sm.face1, sm.face2, plane);
          const mid = new THREE.Vector3().addVectors(Q2, Q1).multiplyScalar(0.5);
          const dir = new THREE.Vector3().subVectors(Q1, Q2);

          const rod = sm.group.getObjectByName('dimRod');
          if (rod) {
            rod.position.copy(mid);
            rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
          }
          const mQ2 = sm.group.getObjectByName('markerQ2');
          if (mQ2) mQ2.position.copy(Q2);
          const mQ1 = sm.group.getObjectByName('markerQ1');
          if (mQ1) mQ1.position.copy(Q1);

          const extLine = sm.group.getObjectByName('extLine');
          if (extLine) {
            extLine.visible = (!plane || plane.distanceToPoint(sm.P1) >= -0.005);
          }

          if (sm.badges && sm.badges.length > 0) {
            for (let j = 0; j < sm.badges.length; j++) {
              sm.badges[j].worldPos.copy(mid);
            }
          }
        } else if (sm.data && sm.data.type === 'cylinder_single' && sm.data.cylData) {
          const anchor = this.findVisibleCylinderAnchor(sm.data.cylData, plane);
          if (anchor && sm.badges && sm.badges.length > 0) {
            for (let j = 0; j < sm.badges.length; j++) {
              sm.badges[j].worldPos.copy(anchor);
            }
          }
        }
      }
    }
  }

  updateSectionClipping() {
    this.applySectionClipping(this.selectionGroup);
    this.applySectionClipping(this.hoverGroup);
    this.applySectionClipping(this.visualsGroup);
    if (this.savedGroup) {
      this.applySectionClipping(this.savedGroup);
    }
    this.updatePlanesDynamicAnchors();
  }

  /**
   * Prominent visual CAD cylinder highlight:
   * Contours exactly to the cylindrical surface, adds 64-segment smooth rings at the rims,
   * center crosshairs, and cylinder central axis.
   */
  renderCylinderHighlight(cylData, colorHex, isHover = false, stepNumber = '1') {
    const group = new THREE.Group();
    group.name = isHover ? 'hoverCylinderHighlight' : `cylinderHighlight_${stepNumber}`;
    const scale = this.getModelScale();

    // 1. Semi-transparent cylindrical mesh overlay
    if (cylData.cylinderGeometry) {
      const cylMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: isHover ? 0.25 : 0.40,
        side: THREE.DoubleSide,
        depthTest: !this.xray,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      const cylMesh = new THREE.Mesh(cylData.cylinderGeometry, cylMat);
      cylMesh.renderOrder = isHover ? 3008 : 3010;
      group.add(cylMesh);
    }

    // 2. Discrete 3D circular ribbon ring at rims (proportional to cylinder size)
    const createRing = (centerPt, isPrimary = true) => {
      let halfW = getAdaptiveRingHalfWidth(cylData.radius, isHover);
      if (!isPrimary) halfW *= 0.75;
      const order = isHover ? 3012 : (isPrimary ? 3018 : 3014);
      return createThickRingMesh(centerPt, cylData.U, cylData.V, cylData.radius, halfW, colorHex, isHover, order, !this.xray);
    };

    const plane = (this.viewer && this.viewer.sectionActive) ? this.viewer.sectionPlane : null;
    let topCenter = cylData.topCenter || cylData.rimCenter || cylData.center;
    if (plane && topCenter && plane.distanceToPoint(topCenter) < -0.005) {
      const visibleAnchor = this.findVisibleCylinderAnchor(cylData, plane);
      if (visibleAnchor) topCenter = visibleAnchor;
    }
    const bottomCenter = cylData.bottomCenter || cylData.otherRimCenter;

    if (topCenter) {
      group.add(createRing(topCenter, true));
    }

    // Second circular ring at opposite rim if cylinder has depth and rim is visible
    if (bottomCenter && cylData.depth > 0.5) {
      if (!plane || plane.distanceToPoint(bottomCenter) >= -0.005) {
        group.add(createRing(bottomCenter, false));
      }
    }

    // 3. Central click pin, crosshairs, and axis line (only for locked selections, not hover)
    if (!isHover) {
      const center = topCenter;
      const pinR = Math.max(0.6, Math.min(1.2, cylData.radius * 0.04));

      // Center marker
      const pinGeom = new THREE.SphereGeometry(pinR, 16, 16);
      const pinMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        depthTest: !this.xray,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      const pin = new THREE.Mesh(pinGeom, pinMat);
      pin.position.copy(center);
      pin.renderOrder = 3020;
      group.add(pin);

      // Center crosshairs along U and V (subtle visible rods scaled with radius)
      const chRodR = Math.max(0.3, Math.min(0.6, cylData.radius * 0.02));
      const chLen = cylData.radius * 0.85;
      const u1 = center.clone().addScaledVector(cylData.U, -chLen);
      const u2 = center.clone().addScaledVector(cylData.U, chLen);
      const v1 = center.clone().addScaledVector(cylData.V, -chLen);
      const v2 = center.clone().addScaledVector(cylData.V, chLen);
      group.add(createThickLineMesh(u1, u2, chRodR, colorHex, !this.xray));
      group.add(createThickLineMesh(v1, v2, chRodR, colorHex, !this.xray));

      // Central Axis line (extending through the hole)
      if (cylData.bottomCenter && cylData.topCenter && !cylData.isCutCircle && cylData.depth > 0.5) {
        const ext = Math.max(cylData.radius * 0.15, 1.0);
        const axisP1 = cylData.bottomCenter.clone().addScaledVector(cylData.axis, -ext);
        const axisP2 = cylData.topCenter.clone().addScaledVector(cylData.axis, ext);
        const axisRod = createThickLineMesh(axisP1, axisP2, Math.max(0.35, chRodR * 0.8), COLOR_ACCENT, !this.xray, true);
        axisRod.renderOrder = 3019;
        group.add(axisRod);
      }
    }

    return this.applySectionClipping(group);
  }

  /**
   * Visual dimensioning between two Cylinders / Holes:
   * - Center-to-center connecting line
   * - Markers at centers
   * - Floating 3D Badge at midpoint
   */
  renderCylinderDimensionVisual(cyl1, cyl2, closest, C1_in = null, C2_in = null) {
    this.visualsGroup.clear();
    const group = new THREE.Group();

    const C1 = C1_in || (cyl1.topCenter || cyl1.center);
    const C2 = C2_in || (cyl2.topCenter || cyl2.center);
    const minR = Math.min(cyl1.radius, cyl2.radius);

    // 1. Solid dimension rod connecting centers (proportional to cylinder size)
    const rodR = Math.max(0.55, Math.min(0.95, minR * 0.035));
    const dimLine = createThickLineMesh(C1, C2, rodR, this.getDimensionColor(), !this.xray, true);
    group.add(dimLine);

    // 2. End markers (crisp small CAD terminal dots, proportional to cylinder size)
    const markerR = Math.max(0.75, Math.min(1.4, minR * 0.045));
    const markerGeom = new THREE.SphereGeometry(markerR, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({
      color: this.getDimensionColor(),
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });

    const m1 = new THREE.Mesh(markerGeom, markerMat);
    m1.position.copy(C1);
    m1.userData.isDimensionLine = true;
    m1.renderOrder = 3021;
    group.add(m1);

    const m2 = new THREE.Mesh(markerGeom, markerMat);
    m2.position.copy(C2);
    m2.userData.isDimensionLine = true;
    m2.renderOrder = 3021;
    group.add(m2);

    this.visualsGroup.add(group);

    // 3. Floating 3D Badge at center midpoint
    const midpoint = new THREE.Vector3().addVectors(C1, C2).multiplyScalar(0.5);
    const dist = C1.distanceTo(C2);
    this.badges = [{
      id: 'measure-main',
      worldPos: midpoint.clone(),
      text: `Centros: ${dist.toFixed(2)} mm`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];
  }

  /**
   * Prominent visual for 3-point circle / arc:
   * Displays 3-point markers, fitted circular ring, crosshair, and radius line.
   */
  render3PointCircleVisual(circleData, A, B, C) {
    this.visualsGroup.clear();
    const group = new THREE.Group();

    // 1. Point markers at A, B, C (crisp CAD markers, proportional)
    const markerR = Math.max(0.7, Math.min(1.3, circleData.radius * 0.045));
    const markerGeom = new THREE.SphereGeometry(markerR, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLOR_ITEM1,
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });

    [A, B, C].forEach((pt) => {
      const m = new THREE.Mesh(markerGeom, markerMat);
      m.position.copy(pt);
      m.renderOrder = 3021;
      group.add(m);
    });

    // 2. Adaptive circular ribbon ring
    const halfW = getAdaptiveRingHalfWidth(circleData.radius, false);
    const ringMesh = createThickRingMesh(circleData.center, circleData.U, circleData.V, circleData.radius, halfW, COLOR_ITEM1, false, 3020, !this.xray);
    group.add(ringMesh);

    // 3. Center crosshairs and pin
    const centerPin = new THREE.Mesh(markerGeom, new THREE.MeshBasicMaterial({ color: COLOR_ACCENT, depthTest: !this.xray }));
    centerPin.position.copy(circleData.center);
    centerPin.renderOrder = 3022;
    group.add(centerPin);

    // 4. Radius line from center to A (proportional)
    const radLineR = Math.max(0.04, Math.min(0.25, circleData.radius * 0.012));
    const radLine = createThickLineMesh(circleData.center, A, radLineR, COLOR_ACCENT, !this.xray);
    group.add(radLine);

    this.visualsGroup.add(group);

    // 5. Floating 3D Badge at center
    this.badges = [{
      id: 'measure-main',
      worldPos: circleData.center.clone(),
      text: `Ø ${circleData.diameter.toFixed(2)} mm (R: ${circleData.radius.toFixed(2)} mm)`,
      screenX: 0,
      screenY: 0,
      visible: false
    }];
  }

  /**
   * Prominent visual CAD face highlight:
   * Contours exactly to the face geometry on the part itself and outlines its perimeter
   */
  renderCADFaceHighlight(faceData, colorHex, isHover = false, stepNumber = '1') {
    const group = new THREE.Group();
    group.name = isHover ? 'hoverFaceHighlight' : `faceHighlight_${stepNumber}`;
    const scale = this.getModelScale();

    // 1. Glowing Face Mesh overlay (exact CAD face triangles)
    if (faceData.faceGeometry) {
      const faceMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: isHover ? 0.25 : 0.42,
        side: THREE.DoubleSide,
        depthTest: !this.xray,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });

      const faceMesh = new THREE.Mesh(faceData.faceGeometry, faceMat);
      faceMesh.renderOrder = isHover ? 3008 : 3010;
      group.add(faceMesh);
    }

    // 2. Boundary contour lines (outer perimeter and inner holes)
    if (faceData.boundarySegments && faceData.boundarySegments.length > 0 && faceData.boundarySegments.length <= 600) {
      const borderGroup = new THREE.Group();
      const r = isHover ? 0.55 : 0.85;
      for (let i = 0; i < faceData.boundarySegments.length; i += 2) {
        const p1 = faceData.boundarySegments[i];
        const p2 = faceData.boundarySegments[i + 1];
        borderGroup.add(createThickLineMesh(p1, p2, r, colorHex, !this.xray, true));
      }
      group.add(borderGroup);
    } else if (faceData.boundaryGeometry) {
      const borderMat = new THREE.LineBasicMaterial({
        color: colorHex,
        linewidth: 2.0,
        depthTest: !this.xray,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      const borderLine = new THREE.LineSegments(faceData.boundaryGeometry, borderMat);
      borderLine.renderOrder = isHover ? 3009 : 3012;
      group.add(borderLine);
    }

    // 3. Central click pin and normal arrow (only for locked selections, not hover)
    if (!isHover && faceData.hitPoint && faceData.normal) {
      const point = faceData.hitPoint;
      const normal = faceData.normal;

      const pinR = 1.0;
      const pinGeom = new THREE.SphereGeometry(pinR, 16, 16);
      const pinMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        depthTest: !this.xray,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5
      });
      const pin = new THREE.Mesh(pinGeom, pinMat);
      pin.position.copy(point);
      pin.renderOrder = 3015;
      group.add(pin);

      // Normal vector arrow
      const arrowLen = 8.0;
      const arrowTip = point.clone().addScaledVector(normal, arrowLen);
      group.add(createThickLineMesh(point, arrowTip, 0.55, colorHex, !this.xray, true));

      const coneGeom = new THREE.ConeGeometry(1.2, 3.2, 16);
      const coneMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        depthTest: !this.xray,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5
      });
      const cone = new THREE.Mesh(coneGeom, coneMat);
      cone.position.copy(arrowTip);
      const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      cone.quaternion.copy(coneQuat);
      cone.renderOrder = 3017;
      group.add(cone);
    }

    return this.applySectionClipping(group);
  }

  /**
   * Prominent visual CAD straight edge / line highlight:
   * Thick cylindrical 3D rod along the arista with spherical end caps
   */
  renderCADEdgeHighlight(edgeData, colorHex, isHover = false, stepNumber = '1') {
    const group = new THREE.Group();
    group.name = isHover ? 'hoverEdgeHighlight' : `edgeHighlight_${stepNumber}`;

    const rodR = isHover ? 0.75 : 1.1;
    const endSphereR = isHover ? 1.2 : 1.6;

    // 1. Solid cylindrical rod along the straight CAD edge
    const rod = createThickLineMesh(edgeData.p1, edgeData.p2, rodR, colorHex, !this.xray, true);
    rod.renderOrder = isHover ? 3010 : 3014;
    group.add(rod);

    // 2. Spherical end markers
    const sphereGeom = new THREE.SphereGeometry(endSphereR, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });

    const m1 = new THREE.Mesh(sphereGeom, sphereMat);
    m1.position.copy(edgeData.p1);
    m1.renderOrder = isHover ? 3011 : 3015;
    group.add(m1);

    const m2 = new THREE.Mesh(sphereGeom, sphereMat);
    m2.position.copy(edgeData.p2);
    m2.renderOrder = isHover ? 3011 : 3015;
    group.add(m2);

    // 3. Central selection pin with step badge (if locked selection)
    if (!isHover && edgeData.midpoint) {
      const pinGeom = new THREE.SphereGeometry(1.2, 16, 16);
      const pin = new THREE.Mesh(pinGeom, sphereMat);
      pin.position.copy(edgeData.midpoint);
      pin.renderOrder = 3016;
      group.add(pin);
    }

    // Cut edges lie directly on the cutting plane: do not clip them so they stay 100% sharp and visible!
    if (edgeData.isCutEdge) {
      return group;
    }

    return this.applySectionClipping(group);
  }

  /**
   * Prominent visual planar quad highlight with borders and normal vector arrow
   */
  renderPlaneHighlight(point, normal, colorHex, stepLabel = '1') {
    const group = new THREE.Group();
    const scale = this.getModelScale();
    const planeSize = Math.min(60, Math.max(16, scale * 0.015));

    // 1. Planar quad
    const quadGeom = new THREE.PlaneGeometry(planeSize, planeSize);
    const quadMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    const quadMesh = new THREE.Mesh(quadGeom, quadMat);

    // Align quad orientation with normal
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, normal);
    quadMesh.quaternion.copy(quat);

    // Position slightly offset along normal to avoid z-fighting
    const offsetPos = point.clone().addScaledVector(normal, 0.2);
    quadMesh.position.copy(offsetPos);
    quadMesh.renderOrder = 3010;
    group.add(quadMesh);

    // 2. Border outline around the planar quad
    const edgesGeom = new THREE.EdgesGeometry(quadGeom);
    const edgesMat = new THREE.LineBasicMaterial({
      color: colorHex,
      linewidth: 2.0,
      depthTest: !this.xray,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });
    const edgesLine = new THREE.LineSegments(edgesGeom, edgesMat);
    edgesLine.renderOrder = 3011;
    quadMesh.add(edgesLine);

    // 3. Central click pin
    const pinR = 1.0;
    const pinGeom = new THREE.SphereGeometry(pinR, 16, 16);
    const pinMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });
    const pin = new THREE.Mesh(pinGeom, pinMat);
    pin.position.copy(point);
    pin.renderOrder = 3012;
    group.add(pin);

    // 4. Normal vector arrow indicating plane orientation
    const arrowLen = 8.0;
    const arrowTip = point.clone().addScaledVector(normal, arrowLen);
    group.add(createThickLineMesh(point, arrowTip, 0.55, colorHex, !this.xray, true));

    const coneGeom = new THREE.ConeGeometry(1.2, 3.2, 16);
    const coneMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });
    const cone = new THREE.Mesh(coneGeom, coneMat);
    cone.position.copy(arrowTip);
    const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    cone.quaternion.copy(coneQuat);
    cone.renderOrder = 3014;
    group.add(cone);

    this.selectionGroup.add(this.applySectionClipping(group));
  }

  /**
   * Visual dimensioning between Planar Faces:
   * - Perpendicular dimension line between P2 and projP1
   * - Dashed projection extension line between P1 and projP1
   * - Floating 3D Badge with true perpendicular thickness
   */
  renderPlanesDimensionVisual(P1, n1, P2, n2, isParallel, perpDist, directDist, angleDeg, signedDist, face1 = null, face2 = null) {
    this.visualsGroup.clear();
    const group = new THREE.Group();
    const scale = this.getModelScale();
    const plane = (this.viewer && this.viewer.sectionActive) ? this.viewer.sectionPlane : null;

    if (isParallel) {
      // Dynamically find visible anchor pair (Q2 on Plane 2, Q1 on Plane 1)
      const { Q2, Q1 } = this.findVisiblePlanesAnchor(P1, n1, P2, signedDist, face1, face2, plane);

      if (perpDist >= 0.05) {
        // 1. Solid perpendicular dimension rod
        const perpLine = createThickLineMesh(Q2, Q1, 0.85, this.getDimensionColor(), !this.xray, true);
        perpLine.name = 'dimRod';
        group.add(perpLine);

        // 2. Dimension end markers at Q2 and Q1
        const markerR = 1.25;
        const markerGeom = new THREE.SphereGeometry(markerR, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({
          color: this.getDimensionColor(),
          depthTest: !this.xray,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5
        });

        const mP2 = new THREE.Mesh(markerGeom, markerMat);
        mP2.position.copy(Q2);
        mP2.name = 'markerQ2';
        mP2.userData.isDimensionLine = true;
        mP2.renderOrder = 3021;
        group.add(mP2);

        const mProj = new THREE.Mesh(markerGeom, markerMat);
        mProj.position.copy(Q1);
        mProj.name = 'markerQ1';
        mProj.userData.isDimensionLine = true;
        mProj.renderOrder = 3021;
        group.add(mProj);

        // 3. Extension projection reference line on Plane 1 (if P1 is visible and displaced from Q1)
        if (!plane || plane.distanceToPoint(P1) >= -0.005) {
          const extDist = P1.distanceTo(Q1);
          if (extDist > 0.5) {
            const extLine = createThickLineMesh(P1, Q1, 0.55, COLOR_ACCENT, !this.xray, true);
            extLine.name = 'extLine';
            extLine.renderOrder = 3019;
            group.add(extLine);
          }
        }

        // 4. Floating 3D Badge at perpendicular midpoint
        const perpMid = new THREE.Vector3().addVectors(Q2, Q1).multiplyScalar(0.5);
        this.badges = [{
          id: 'measure-main',
          worldPos: perpMid.clone(),
          text: `⟂ ${perpDist.toFixed(2)} mm`,
          targetFaces: [face1, face2].filter(Boolean),
          screenX: 0,
          screenY: 0,
          visible: false
        }];
      } else {
        // Coplanar faces: connecting rod between P1 and P2
        const coplanarLine = createThickLineMesh(P1, P2, 0.85, this.getDimensionColor(), !this.xray, true);
        coplanarLine.name = 'dimRod';
        group.add(coplanarLine);

        const mid = new THREE.Vector3().addVectors(P1, P2).multiplyScalar(0.5);
        this.badges = [{
          id: 'measure-main',
          worldPos: mid.clone(),
          text: `0.00 mm (Coplanar)`,
          targetFaces: [face1, face2].filter(Boolean),
          screenX: 0,
          screenY: 0,
          visible: false
        }];
      }
    } else {
      // Angled faces: connecting rod between P1 and P2
      const line = createThickLineMesh(P1, P2, 0.85, this.getDimensionColor(), !this.xray, true);
      line.name = 'dimRod';
      group.add(line);

      const mid = new THREE.Vector3().addVectors(P1, P2).multiplyScalar(0.5);
      this.badges = [{
        id: 'measure-main',
        worldPos: mid.clone(),
        text: `∠ ${angleDeg.toFixed(1)}°`,
        targetFaces: [face1, face2].filter(Boolean),
        screenX: 0,
        screenY: 0,
        visible: false
      }];
    }

    this.visualsGroup.add(this.applySectionClipping(group));
  }

  /**
   * Prominent visual marker pin for P1 or P2
   */
  renderPointMarker(point, colorHex, labelNumber) {
    const scale = Math.max(0.6, this.getSnapThreshold(point) * 0.18);
    const r = 1.0;
    const geom = new THREE.SphereGeometry(r, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });
    const sphere = new THREE.Mesh(geom, mat);
    sphere.position.copy(point);
    sphere.scale.set(scale, scale, scale);
    sphere.renderOrder = 3010;
    this.selectionGroup.add(sphere);

    // Subtle billboarded outer ring
    const ringGeom = new THREE.RingGeometry(r * 1.3, r * 1.8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
      depthTest: !this.xray,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    if (this.camera) {
      ring.quaternion.copy(this.camera.quaternion);
    }
    ring.renderOrder = 3011;
    sphere.add(ring);
  }

  /**
   * Render linear 3D dimension line, end markers, and badge anchor
   */
  renderDimensionLine(p1, p2, labelText) {
    this.visualsGroup.clear();
    const group = new THREE.Group();

    // 1. Solid dimension rod
    const line = createThickLineMesh(p1, p2, 0.85, this.getDimensionColor(), !this.xray, true);
    group.add(line);

    // 2. End markers (crisp CAD terminal dots)
    const markerR = 1.25;
    const markerGeom = new THREE.SphereGeometry(markerR, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({
      color: this.getDimensionColor(),
      depthTest: !this.xray,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5
    });

    const m1 = new THREE.Mesh(markerGeom, markerMat);
    m1.position.copy(p1);
    m1.userData.isDimensionLine = true;
    m1.renderOrder = 3026;
    group.add(m1);

    const m2 = new THREE.Mesh(markerGeom, markerMat);
    m2.position.copy(p2);
    m2.userData.isDimensionLine = true;
    m2.renderOrder = 3026;
    group.add(m2);

    this.visualsGroup.add(group);

    // 3. Floating 3D Badge at line midpoint
    const midpoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    this.badges = [{
      id: 'measure-main',
      worldPos: midpoint.clone(),
      text: labelText,
      screenX: 0,
      screenY: 0,
      visible: false
    }];
  }

  /**
   * Evaluates whether a measurement should be visible on screen based on:
   * 1. Visibility of measured objects in the scene/tree (if a part is hidden or isolated-out, hide the cota)
   * 2. Section cut clipping plane (if points are in the cut-away/removed part, hide the cota)
   */
  isMeasurementVisible(entry) {
    if (!entry) return true;

    // 1. Check if any associated mesh is hidden / invisible / isolated-out
    const meshes = entry.targetMeshes;
    if (meshes && meshes.length > 0 && this.viewer && typeof this.viewer.isMeshVisibleInView === 'function') {
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        if (!this.viewer.isMeshVisibleInView(m)) {
          return false; // If one of the objects is hidden, the measurement between them must not show!
        }
      }
    }

    // 2. Check if the measurement is on a cut-away / removed section
    if (this.viewer && this.viewer.sectionActive && this.viewer.sectionPlane) {
      const plane = this.viewer.sectionPlane;

      // CAD Faces: If ANY measured face is COMPLETELY cut away, hide measurement.
      // But as long as every measured face has at least one visible part, it remains visible!
      if (entry.targetFaces && entry.targetFaces.length > 0) {
        for (let i = 0; i < entry.targetFaces.length; i++) {
          const face = entry.targetFaces[i];
          if (!this.isFaceVisibleUnderPlane(face, plane)) {
            return false;
          }
        }
      }

      // CAD Edges: If ANY measured edge is COMPLETELY cut away, hide measurement.
      if (entry.targetEdges && entry.targetEdges.length > 0) {
        for (let i = 0; i < entry.targetEdges.length; i++) {
          const edge = entry.targetEdges[i];
          if (!this.isEdgeVisibleUnderPlane(edge, plane)) {
            return false;
          }
        }
      }

      // CAD Cylinders: If ANY measured cylinder is COMPLETELY cut away, hide measurement.
      if (entry.targetCylinders && entry.targetCylinders.length > 0) {
        for (let i = 0; i < entry.targetCylinders.length; i++) {
          const cyl = entry.targetCylinders[i];
          if (!this.isCylinderVisibleUnderPlane(cyl, plane)) {
            return false;
          }
        }
      }

      // Pure entity measurements (face-face, edge-edge, cyl-cyl, edge-face, etc.) do NOT
      // check discrete targetPoints because the dimension dynamically anchors to the visible slice.
      const isEntityToEntity = (entry.targetFaces && entry.targetFaces.length >= 2) ||
                               (entry.targetEdges && entry.targetEdges.length >= 2) ||
                               (entry.targetCylinders && entry.targetCylinders.length >= 2) ||
                               (entry.targetFaces && entry.targetEdges && entry.targetFaces.length > 0 && entry.targetEdges.length > 0) ||
                               (entry.targetFaces && entry.targetCylinders && entry.targetFaces.length > 0 && entry.targetCylinders.length > 0) ||
                               (entry.targetEdges && entry.targetCylinders && entry.targetEdges.length > 0 && entry.targetCylinders.length > 0) ||
                               (entry.type === 'planes' || entry.type === 'planes_angle' || entry.type === 'lines_parallel' || entry.type === 'lines_angle' || entry.type === 'cylinders_distance' || entry.type === 'cylinder_single' || entry.type === 'edge_single' || entry.type === 'edge_cut_single');

      if (!isEntityToEntity) {
        const points = entry.targetPoints;
        if (points && points.length > 0) {
          for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (pt && plane.distanceToPoint(pt) < -0.005) {
              return false;
            }
          }
        }
        if (entry.worldPos && plane.distanceToPoint(entry.worldPos) < -0.005) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Update 2D screen projections of floating 3D dimension badges
   * Called every frame from requestAnimationFrame in viewer.js
   */
  update() {
    // 1. Synchronize visibility of saved measurements and their 3D groups
    if (this.savedMeasurements && this.savedMeasurements.length > 0) {
      for (let i = 0; i < this.savedMeasurements.length; i++) {
        const sm = this.savedMeasurements[i];
        const isVisible = this.isMeasurementVisible(sm);
        if (sm.group) {
          sm.group.visible = isVisible;
        }
        if (sm.badges) {
          for (let j = 0; j < sm.badges.length; j++) {
            sm.badges[j].measureVisible = isVisible;
          }
        }
      }
    }

    // 2. Synchronize active draft measurement and visuals visibility
    if (this.currentMeasurement) {
      const activeVisible = this.isMeasurementVisible(this.currentMeasurement);
      if (this.visualsGroup) this.visualsGroup.visible = activeVisible;
      if (this.selectionGroup) this.selectionGroup.visible = activeVisible;
      if (this.badges) {
        for (let k = 0; k < this.badges.length; k++) {
          this.badges[k].measureVisible = activeVisible;
        }
      }
    } else if (this.firstSelection) {
      const firstMesh = this.firstSelection.mesh || this.firstSelection.rawHit?.object;
      const firstPt = this.firstSelection.point;
      let firstVisible = true;
      if (firstMesh && this.viewer && typeof this.viewer.isMeshVisibleInView === 'function' && !this.viewer.isMeshVisibleInView(firstMesh)) {
        firstVisible = false;
      }
      if (this.viewer && this.viewer.sectionActive && this.viewer.sectionPlane) {
        if (this.firstSelection.faceData) {
          if (!this.isFaceVisibleUnderPlane(this.firstSelection.faceData, this.viewer.sectionPlane)) {
            firstVisible = false;
          }
        } else if (this.firstSelection.edgeData) {
          if (!this.isEdgeVisibleUnderPlane(this.firstSelection.edgeData, this.viewer.sectionPlane)) {
            firstVisible = false;
          }
        } else if (this.firstSelection.cylData) {
          if (!this.isCylinderVisibleUnderPlane(this.firstSelection.cylData, this.viewer.sectionPlane)) {
            firstVisible = false;
          }
        } else if (firstPt) {
          if (this.viewer.sectionPlane.distanceToPoint(firstPt) < -0.005) {
            firstVisible = false;
          }
        }
      }
      if (this.selectionGroup) this.selectionGroup.visible = firstVisible;
      if (this.badges) {
        for (let k = 0; k < this.badges.length; k++) {
          this.badges[k].measureVisible = firstVisible;
        }
      }
    }

    const allBadges = this.getAllBadges();
    if (allBadges.length === 0 || !this.camera || !this.renderer) return;

    const dom = this.renderer.domElement;
    const rect = dom.getBoundingClientRect();
    const tempV = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const toPt = new THREE.Vector3();
    if (this.camera && this.camera.getWorldDirection) {
      this.camera.getWorldDirection(camDir);
    }

    for (let i = 0; i < allBadges.length; i++) {
      const badge = allBadges[i];
      if (!badge.worldPos) continue;

      let canShow = badge.measureVisible !== false;

      // Check if badge anchor itself is clipped away by cutting plane (only for badges without target CAD entities)
      if (canShow && this.viewer && this.viewer.sectionActive && this.viewer.sectionPlane) {
        const hasEntities = (badge.targetFaces && badge.targetFaces.length > 0) ||
                            (badge.targetEdges && badge.targetEdges.length > 0) ||
                            (badge.targetCylinders && badge.targetCylinders.length > 0);
        if (!hasEntities) {
          if (this.viewer.sectionPlane.distanceToPoint(badge.worldPos) < -0.005) {
            canShow = false;
          }
        }
      }

      toPt.subVectors(badge.worldPos, this.camera.position);
      const isInFront = camDir.dot(toPt) > 0;

      tempV.copy(badge.worldPos);
      tempV.project(this.camera);

      // In front of camera check (z in [-1, 1] and positive dot along camera forward)
      if (canShow && isInFront && tempV.z >= -1.0 && tempV.z <= 1.0) {
        badge.screenX = (tempV.x * 0.5 + 0.5) * rect.width;
        badge.screenY = (-(tempV.y * 0.5) + 0.5) * rect.height;
        badge.visible = true;
      } else {
        badge.visible = false;
      }

      const ox = badge.offsetX || 0;
      const oy = badge.offsetY || 0;
      const hasOffset = Math.abs(ox) > 4 || Math.abs(oy) > 4;

      // Synchronize DOM elements directly for 60fps zero-latency rendering
      const el = document.getElementById('badge-' + badge.id);
      if (el) {
        el.style.display = badge.visible ? 'block' : 'none';
        if (badge.visible) {
          el.style.left = (badge.screenX + ox) + 'px';
          el.style.top = (badge.screenY + oy) + 'px';
        }
      }

      // Synchronize SVG leader line and anchor point dot
      const svgLine = document.getElementById('badge-line-' + badge.id);
      if (svgLine) {
        if (badge.visible && hasOffset) {
          svgLine.style.display = 'block';
          svgLine.setAttribute('x1', badge.screenX);
          svgLine.setAttribute('y1', badge.screenY);
          svgLine.setAttribute('x2', badge.screenX + ox);
          svgLine.setAttribute('y2', badge.screenY + oy);
        } else {
          svgLine.style.display = 'none';
        }
      }

      const svgDot = document.getElementById('badge-dot-' + badge.id);
      if (svgDot) {
        if (badge.visible && hasOffset) {
          svgDot.style.display = 'block';
          svgDot.setAttribute('cx', badge.screenX);
          svgDot.setAttribute('cy', badge.screenY);
        } else {
          svgDot.style.display = 'none';
        }
      }
    }
  }

  emitUpdate(extra = {}) {
    if (this.onUpdateCallback) {
      this.onUpdateCallback({
        isActive: this.isActive,
        mode: this.mode,
        firstSelection: this.firstSelection,
        secondSelection: this.secondSelection,
        measurement: this.currentMeasurement,
        badges: this.getAllBadges(),
        savedMeasurements: this.savedMeasurements.map(m => m.data),
        prompt: this.statusPrompt,
        radiusPointsCount: this.arcPoints ? this.arcPoints.length : 0,
        keepMeasurementsOnExit: this.keepMeasurementsOnExit,
        ...extra
      });
    }
  }
}
