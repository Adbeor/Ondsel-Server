// SPDX-FileCopyrightText: 2024 Ondsel <development@ondsel.com>
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { fitCameraToSelection, getSelectedObject } from '@/threejs/cameraUtils'
import { Importer } from '@/threejs/libs/import/importer';
import { OBJ_COLOR, OBJ_HIGHLIGHTED_COLOR, EDGE_COLOR } from '@/threejs/libs/constants';
import { getObject3dFromScene } from '@/threejs/libs/utils/sceneutils';
import {ModelObjectType} from "@/threejs/libs/model/object";
import { MeasurementTool } from '@/threejs/measurementTool';


const ViewerConfig = {
  showEdges: false,
  showAxisHelper: true,
}

// --- Procedural Vector CAD Hatching & Multi-Object Capping System ---
// Soft, architectural pastel palette (clean, washed, elegant CAD drafting look)
const SECTION_PALETTES_PASTEL = [
  // 1. Soft Sky Blue (45 deg)
  { bg: '#bfdbfe', line: '#1e40af', angle: Math.PI / 4 },
  // 2. Soft Warm Amber Peach (135 deg)
  { bg: '#fde68a', line: '#854d0e', angle: (3 * Math.PI) / 4 },
  // 3. Soft Mint Seafoam (45 deg)
  { bg: '#a7f3d0', line: '#065f46', angle: Math.PI / 4 },
  // 4. Soft Lavender Amethyst (135 deg)
  { bg: '#e9d5ff', line: '#581c87', angle: (3 * Math.PI) / 4 },
  // 5. Soft Coral Rose (45 deg)
  { bg: '#fecdd3', line: '#9f1239', angle: Math.PI / 4 },
  // 6. Soft Aqua Cyan (135 deg)
  { bg: '#a5f3fc', line: '#155e75', angle: (3 * Math.PI) / 4 },
  // 7. Soft Sun Gold (45 deg)
  { bg: '#fef08a', line: '#713f12', angle: Math.PI / 4 },
  // 8. Soft Titanium Slate (135 deg)
  { bg: '#cbd5e1', line: '#1e293b', angle: (3 * Math.PI) / 4 },
  // 9. Soft Orchid Pink (45 deg)
  { bg: '#f5d0fe', line: '#86198f', angle: Math.PI / 4 },
  // 10. Soft Lime Pear (135 deg)
  { bg: '#d9f99d', line: '#3f6212', angle: (3 * Math.PI) / 4 },
  // 11. Soft Periwinkle (45 deg)
  { bg: '#c7d2fe', line: '#3730a3', angle: Math.PI / 4 },
  // 12. Soft Apricot Tangerine (135 deg)
  { bg: '#fed7aa', line: '#9a3412', angle: (3 * Math.PI) / 4 }
];

// High-contrast vivid palette
const SECTION_PALETTES_VIVID = [
  // 1. Vivid Cobalt Blue (45 deg)
  { bg: '#60a5fa', line: '#1e3a8a', angle: Math.PI / 4 },
  // 2. Vivid Warm Amber Orange (135 deg)
  { bg: '#f59e0b', line: '#78350f', angle: (3 * Math.PI) / 4 },
  // 3. Vivid Emerald Mint Green (45 deg)
  { bg: '#10b981', line: '#064e3b', angle: Math.PI / 4 },
  // 4. Vivid Royal Purple / Amethyst (135 deg)
  { bg: '#a855f7', line: '#4c1d95', angle: (3 * Math.PI) / 4 },
  // 5. Vivid Coral Rose Crimson (45 deg)
  { bg: '#f43f5e', line: '#881337', angle: Math.PI / 4 },
  // 6. Vivid Oceanic Cyan Teal (135 deg)
  { bg: '#06b6d4', line: '#164e63', angle: (3 * Math.PI) / 4 },
  // 7. Vivid Sun Gold Yellow (45 deg)
  { bg: '#eab308', line: '#713f12', angle: Math.PI / 4 },
  // 8. Cool Titanium Slate (135 deg)
  { bg: '#94a3b8', line: '#0f172a', angle: (3 * Math.PI) / 4 },
  // 9. Vivid Orchid Fuchsia (45 deg)
  { bg: '#d946ef', line: '#701a75', angle: Math.PI / 4 },
  // 10. Vivid Lime Green (135 deg)
  { bg: '#84cc16', line: '#365314', angle: (3 * Math.PI) / 4 },
  // 11. Vivid Indigo Periwinkle (45 deg)
  { bg: '#6366f1', line: '#312e81', angle: Math.PI / 4 },
  // 12. Vivid Burnt Tangerine (135 deg)
  { bg: '#f97316', line: '#7c2d12', angle: (3 * Math.PI) / 4 }
];

const HATCH_VERTEX_SHADER = `
varying vec2 vPos;

void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HATCH_FRAGMENT_SHADER = `
#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif

precision highp float;

uniform vec3 uBgColor;
uniform vec3 uLineColor;
uniform float uAngle;
uniform float uSpacing;
uniform float uLineWidth;
uniform float uStyle; // 0.0: diagonal, 1.0: cross, 2.0: solid

varying vec2 vPos;

void main() {
  if (uStyle > 1.5) {
    gl_FragColor = vec4(uBgColor, 1.0);
    return;
  }

  float cosA = cos(uAngle);
  float sinA = sin(uAngle);
  vec2 rot = vec2(vPos.x * cosA - vPos.y * sinA, vPos.x * sinA + vPos.y * cosA);

  // Primary parallel lines (rot.x)
  float u1 = rot.x / uSpacing;
  float dist1 = abs(fract(u1 + 0.5) - 0.5) * uSpacing;
  float px1 = fwidth(rot.x);
  float hw1 = max(uLineWidth * 0.5, px1 * 0.75);
  float aa1 = max(px1, 0.001);
  float line1 = 1.0 - smoothstep(hw1 - aa1 * 0.5, hw1 + aa1 * 0.5, dist1);

  float finalLine = line1;

  if (uStyle > 0.5) {
    // Cross-hatch perpendicular lines (rot.y)
    float u2 = rot.y / uSpacing;
    float dist2 = abs(fract(u2 + 0.5) - 0.5) * uSpacing;
    float px2 = fwidth(rot.y);
    float hw2 = max(uLineWidth * 0.5, px2 * 0.75);
    float aa2 = max(px2, 0.001);
    float line2 = 1.0 - smoothstep(hw2 - aa2 * 0.5, hw2 + aa2 * 0.5, dist2);

    finalLine = max(line1, line2);
  }

  vec3 col = mix(uBgColor, uLineColor, clamp(finalLine, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Viewer {

  constructor(url, width, height, viewport, window, onLoadCallback, onModelClickCallback=null) {
    this.url = url;
    this.width = width;
    this.height = height;
    this.viewport = viewport;
    this.window = window;
    this.obj = null;
    this.lineSegments = null;
    this.axisHelper = null
    this.scene = null;
    this.renderer = null;
    this.controls = null;
    this.camera = null;
    this.objLoader = new OBJLoader();
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.selectedObjs = [];
    this.isolatedObject = null;
    this.onContextMenuCallback = null;
    this.pointerDownPos = { x: 0, y: 0 };
    this.pointerDownTime = 0;
    this.rightPointerDownPos = { x: 0, y: 0 };
    this.rightPointerDownTime = 0;
    this.onLoadCallback = onLoadCallback;
    this.onModelClickCallback = onModelClickCallback;
    this.importer = new Importer();
    this.model = null;

    this.initViewer();
  }

  initViewer() {
    const VIEW_ANGLE = 45;
    const ASPECT = this.width / this.height;
    const NEAR = 0.1;
    const FAR = 20000;

    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      stencil: true
    });
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0xFFFF00, 0); // the default
    this.renderer.setPixelRatio(window.devicePixelRatio * 1.5);
    this.renderer.setSize(this.width, this.height);

    this.initSectionAnalysis();

    this.camera = new THREE.PerspectiveCamera(
      VIEW_ANGLE, // Field of view
      ASPECT, // Aspect ratio
      NEAR, // Near plane
      FAR, // Far plane
    );

    // Position the camera along the negative Y-axis
    this.camera.position.set(1, -1, 1);
    // Set the camera's "up" vector to the Z-axis
    this.camera.up.set(0, 0, 1);

    this.scene.add(this.camera);

    this.createLights();

    this.initControls();
    this.measurementTool = new MeasurementTool(this);

    this.loadOBJ();

    this.onPointerDownHandler = this.onPointerDown.bind(this);
    this.onPointerUpHandler = this.onPointerUp.bind(this);
    this.onContextMenuHandler = this.onContextMenu.bind(this);

    this.viewport.addEventListener('pointerdown', this.onPointerDownHandler);
    this.viewport.addEventListener('pointerup', this.onPointerUpHandler);
    this.viewport.addEventListener('contextmenu', this.onContextMenuHandler);

    this.animate()
  }

  animate() {
    requestAnimationFrame( this.animate.bind(this));

    this.controls.update();

    if (this.measurementTool && (this.measurementTool.isActive || (this.measurementTool.hasVisibleBadges && this.measurementTool.hasVisibleBadges()))) {
      this.measurementTool.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  createLights() {
    const ambientLight = new THREE.AmbientLight(0xcccccc, 0.2);
    this.scene.add(ambientLight);
    const pointLight = new THREE.PointLight(0xffffff, 0.8);
    this.camera.add(pointLight);
  }

  loadOBJ() {
    this.objLoader = new OBJLoader();

    if (this.obj) {
      this.scene.remove(this.obj);
    }
    if (this.lineSegments) {
      this.scene.remove(this.lineSegments);
    }
    if (this.customPlaneHelper) {
      this.scene.remove(this.customPlaneHelper);
      this.customPlaneHelper = null;
    }
    this.clearSectionCapsAndStencils();
    this.importer.LoadFile(this.url, this.onFileConverted.bind(this));
  }

  onFileConverted(model) {
    this.model = model;
    this.obj = model.GetCompoundObject();
    this.initPartIndexMap();
    this.scene.add(this.obj)
    this.lineSegments = new THREE.Group()
    for (let obj of this.obj.children) {
      for (let child of obj.children) {
        if (child instanceof THREE.Mesh) {
          if (child.geometry !== undefined) {
            const edges = new THREE.EdgesGeometry(child.geometry);
            const line = new THREE.LineSegments(
              edges,
              new THREE.LineBasicMaterial({ color: EDGE_COLOR, linewidth: 1}),
            );
            this.lineSegments.add(line);
          }
        }
      }
    }
    if (ViewerConfig.showEdges) {
      this.scene.add(this.lineSegments);
    }
    if (!this.axisHelper) {
      this.addAxesHelper();
      fitCameraToSelection(this.camera, this.controls, this.obj);
    }

    if (this.sectionActive) {
      this.clearSectionCapsAndStencils();
      this.setSectionAnalysis({});
    }

    this.onLoadCallback();
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
  }

  addAxesHelper() {
    const box = new THREE.Box3();
    box.setFromObject(this.obj);
    const size = new THREE.Vector3();
    box.getSize(size)
    const maxSize = Math.max(size.x * 2, size.y * 2, size.z * 2);

    this.axisHelper = new THREE.AxesHelper( maxSize );
    if (ViewerConfig.showAxisHelper) {
      this.scene.add(this.axisHelper);
    }
  }

  fitCameraToObjects() {
    if (this.selectedObjs.length > 0) {
      const validObjects = this.selectedObjs.map(o => o.object3d).filter(Boolean);
      if (validObjects.length > 0) {
        fitCameraToSelection(this.camera, this.controls, validObjects);
        return;
      }
    }
    if (this.obj) {
      fitCameraToSelection(this.camera, this.controls, this.obj);
    }
  }

  onPointerDown(event) {
    if (event.button === 0) {
      this.pointerDownPos = { x: event.clientX, y: event.clientY };
      this.pointerDownTime = performance.now();
    } else if (event.button === 2) {
      this.rightPointerDownPos = { x: event.clientX, y: event.clientY };
      this.rightPointerDownTime = performance.now();
    }
  }

  onPointerUp(event) {
    if (this._isDraggingSectionPlane || (this.sectionTransformControl && (this.sectionTransformControl.dragging || this.sectionTransformControl.axis !== null))) {
      return;
    }
    if (this.measurementTool && this.measurementTool.isActive) {
      return;
    }
    if (event.button !== 0) return; // Only process left click

    const dx = event.clientX - this.pointerDownPos.x;
    const dy = event.clientY - this.pointerDownPos.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - this.pointerDownTime;

    // Ignore if camera orbit/pan drag or prolonged click
    if (dist > 5 || dt > 1200) return;

    this.handleCanvasClick(event);
  }

  handleCanvasClick(event) {
    if (!this.renderer || !this.renderer.domElement || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const selectedMesh = this.raycastMesh(this.pointer);
    if (selectedMesh) {
      const modelObject3d = this.findModelObjectForThreeObject(selectedMesh);
      if (modelObject3d) {
        this.selectGivenObject(modelObject3d, true);
      }
    } else {
      // Empty background click: clear selection if not holding Ctrl or Shift
      if (!event.shiftKey && !event.ctrlKey && this.selectedObjs.length > 0) {
        this.clearSelection(true);
      }
    }
  }

  onContextMenu(event) {
    event.preventDefault();
    if (this._isDraggingSectionPlane || (this.sectionTransformControl && (this.sectionTransformControl.dragging || this.sectionTransformControl.axis !== null))) {
      return;
    }
    if (this.measurementTool && this.measurementTool.isActive) {
      return;
    }

    const dx = event.clientX - this.rightPointerDownPos.x;
    const dy = event.clientY - this.rightPointerDownPos.y;
    const dist = Math.hypot(dx, dy);

    // If mouse was dragged to pan camera, do not open context menu
    if (dist > 5) return;

    if (!this.renderer || !this.renderer.domElement || !this.camera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const selectedMesh = this.raycastMesh(this.pointer);
    const modelObject = selectedMesh ? this.findModelObjectForThreeObject(selectedMesh) : null;

    if (this.onContextMenuCallback) {
      this.onContextMenuCallback({
        event,
        clientX: event.clientX,
        clientY: event.clientY,
        modelObject,
        selectedMesh
      });
    }
  }

  isMeshVisibleInView(mesh) {
    if (!mesh || !mesh.isMesh) return false;
    if (mesh.userData && (mesh.userData.isHelper || mesh.userData.isStencilMesh || mesh.userData.isHelperMesh || mesh.userData.isCapMesh)) return false;

    // 1. Check Three.js scene graph visibility
    let p = mesh;
    while (p && p !== this.scene) {
      if (p.visible === false) return false;
      p = p.parent;
    }

    // 2. Check ModelObject3D visibility and hierarchy
    if (this.model && this.model.objects) {
      const mo = this.findModelObjectForThreeObject(mesh);
      if (mo) {
        if (mo.GetVisibility && !mo.GetVisibility()) return false;
        if (mo.object3d && mo.object3d.visible === false) return false;

        let curMo = mo.parent;
        while (curMo) {
          if (curMo.GetVisibility && !curMo.GetVisibility()) return false;
          curMo = curMo.parent;
        }

        // 3. If isolation is active, only the isolated object and its descendants are visible
        if (this.isolatedObject) {
          const isTargetOrDescendant = (mo.uuid === this.isolatedObject.uuid) ||
            (this.isolatedObject.GetAllChildren && this.isolatedObject.GetAllChildren().some(c => c.uuid === mo.uuid));
          if (!isTargetOrDescendant) return false;
        }
      }
    }

    return true;
  }

  raycastMesh(pointer) {
    if (!this.obj || !this.camera) return null;
    this.raycaster.setFromCamera(pointer, this.camera);

    const intersects = this.raycaster.intersectObject(this.obj, true);
    for (const hit of intersects) {
      if (hit.object && this.isMeshVisibleInView(hit.object)) {
        if (this.sectionActive && this.sectionPlane) {
          if (this.sectionPlane.distanceToPoint(hit.point) < -0.005) {
            continue;
          }
        }
        return hit.object;
      }
    }
    return null;
  }

  findModelObjectForThreeObject(threeObj) {
    if (!threeObj || !this.model || !this.model.objects) return null;
    let curr = threeObj;
    while (curr && curr !== this.scene) {
      for (const mo of this.model.objects) {
        if (mo.object3d === curr || (mo.object3d && mo.object3d.uuid === curr.uuid)) {
          return mo;
        }
      }
      if (this.model.findObjectByMeshUuid) {
        const byUuid = this.model.findObjectByMeshUuid(curr.uuid);
        if (byUuid) return byUuid;
      }
      curr = curr.parent;
    }
    return null;
  }

  applyHighlightToModelObject(modelObject3d, isHighlighted) {
    if (!modelObject3d || !modelObject3d.object3d) return;
    const highlightColor = new THREE.Color(OBJ_HIGHLIGHTED_COLOR);
    const normalColor = modelObject3d.GetColor ? modelObject3d.GetColor() : new THREE.Color(OBJ_COLOR);

    modelObject3d.object3d.traverse(child => {
      if (child.isMesh && child.material) {
        const processMat = (mat) => {
          if (!mat) return;
          if (!mat.userData) mat.userData = {};
          if (!mat.userData.origColor && mat.color) {
            mat.userData.origColor = mat.color.clone();
          }
          if (mat.color) {
            if (isHighlighted) {
              mat.color.copy(highlightColor);
            } else {
              mat.color.copy(mat.userData.origColor || normalColor);
            }
          }
        };

        if (Array.isArray(child.material)) {
          child.material.forEach(processMat);
        } else {
          processMat(child.material);
        }
      }
    });
  }

  selectGivenObject(modelObject3d, triggerObjectClickEvent = false) {
    if (!modelObject3d) return;
    const isCurrentlySelected = this.selectedObjs.some(o => o.uuid === modelObject3d.uuid);
    if (!isCurrentlySelected) {
      this.applyHighlightToModelObject(modelObject3d, true);
      this.selectedObjs.push(modelObject3d);
    } else {
      this.applyHighlightToModelObject(modelObject3d, false);
      const index = this.selectedObjs.findIndex(o => o.uuid === modelObject3d.uuid);
      if (index > -1) {
        this.selectedObjs.splice(index, 1);
      }
    }
    if (triggerObjectClickEvent && this.onModelClickCallback) {
      this.onModelClickCallback(modelObject3d);
    }
  }

  clearSelection(triggerCallback = true) {
    for (const obj of [...this.selectedObjs]) {
      this.applyHighlightToModelObject(obj, false);
      if (triggerCallback && this.onModelClickCallback) {
        this.onModelClickCallback(obj);
      }
    }
    this.selectedObjs = [];
  }

  notifyVisibilityChange(modelObject = null) {
    if (this.sectionActive) {
      this.rebuildSectionCaps();
    }
    if (this._visibilityCallbacks) {
      this._visibilityCallbacks.forEach(cb => {
        try {
          cb(modelObject);
        } catch (e) {
          console.error('[Viewer] Visibility callback error:', e);
        }
      });
    }
  }

  onVisibilityChange(callback) {
    if (!this._visibilityCallbacks) {
      this._visibilityCallbacks = [];
    }
    this._visibilityCallbacks.push(callback);
    return () => {
      this._visibilityCallbacks = this._visibilityCallbacks.filter(cb => cb !== callback);
    };
  }

  hideObject(modelObject) {
    if (!modelObject) return;
    modelObject.ToggleVisibility(false);
    if (modelObject.object3d) modelObject.object3d.visible = false;
    if (modelObject.GetAllChildren) {
      modelObject.GetAllChildren().forEach(c => {
        if (c.object3d) c.object3d.visible = false;
      });
    }
    if (this.selectedObjs.some(o => o.uuid === modelObject.uuid)) {
      this.selectGivenObject(modelObject, true);
    }
    this.notifyVisibilityChange(modelObject);
  }

  showObject(modelObject) {
    if (!modelObject) return;
    if (this.isolatedObject && this.isolatedObject.uuid !== modelObject.uuid) {
      this.isolatedObject = null;
    }
    modelObject.ToggleVisibility(true);
    if (modelObject.object3d) modelObject.object3d.visible = true;
    if (modelObject.GetAllChildren) {
      modelObject.GetAllChildren().forEach(c => {
        if (c.object3d) c.object3d.visible = true;
      });
    }
    this.notifyVisibilityChange(modelObject);
  }

  toggleObjectVisibility(modelObject) {
    if (!modelObject) return;
    const current = modelObject.GetVisibility ? modelObject.GetVisibility() : true;
    if (current) {
      this.hideObject(modelObject);
    } else {
      this.showObject(modelObject);
    }
  }

  isolateObject(targetModelObject) {
    if (!this.model || !this.model.objects || !targetModelObject) return;
    this.isolatedObject = targetModelObject;
    const targetUuid = targetModelObject.uuid;

    // Collect all descendants of target
    const targetDescendantUuids = new Set(
      (targetModelObject.GetAllChildren ? targetModelObject.GetAllChildren() : []).map(c => c.uuid)
    );

    // Collect all ancestors of target (they must stay visible in Three.js hierarchy)
    const targetAncestorUuids = new Set();
    let curr = targetModelObject.parent;
    while (curr) {
      targetAncestorUuids.add(curr.uuid);
      curr = curr.parent;
    }

    for (const obj of this.model.objects) {
      if (!obj.userData) obj.userData = {};
      if (obj.userData.preIsolateVisibility === undefined) {
        obj.userData.preIsolateVisibility = obj.GetVisibility();
      }

      if (obj.uuid === targetUuid || targetDescendantUuids.has(obj.uuid)) {
        obj.ToggleVisibility(true);
        if (obj.object3d) obj.object3d.visible = true;
      } else if (targetAncestorUuids.has(obj.uuid)) {
        // Ancestor group/assembly must remain visible in Three.js so the child isn't clipped
        if (obj.object3d) obj.object3d.visible = true;
      } else {
        obj.ToggleVisibility(false);
        if (obj.object3d) obj.object3d.visible = false;
      }
    }
    this.notifyVisibilityChange(targetModelObject);
  }

  restoreIsolation() {
    if (!this.model || !this.model.objects) return;
    for (const obj of this.model.objects) {
      if (obj.userData && obj.userData.preIsolateVisibility !== undefined) {
        obj.ToggleVisibility(obj.userData.preIsolateVisibility);
        if (obj.object3d) obj.object3d.visible = obj.userData.preIsolateVisibility;
        delete obj.userData.preIsolateVisibility;
      } else {
        obj.ToggleVisibility(true);
        if (obj.object3d) obj.object3d.visible = true;
      }
    }
    this.isolatedObject = null;
    this.notifyVisibilityChange(null);
  }

  showAllObjects() {
    if (!this.model || !this.model.objects) return;
    for (const obj of this.model.objects) {
      obj.ToggleVisibility(true);
      if (obj.object3d) obj.object3d.visible = true;
      if (obj.userData) delete obj.userData.preIsolateVisibility;
    }
    this.isolatedObject = null;
    this.notifyVisibilityChange(null);
  }

  setObjectOpacity(modelObject, opacity) {
    if (!modelObject || !modelObject.object3d) return;
    modelObject.opacityLevel = opacity;

    modelObject.object3d.traverse(child => {
      if (child.isMesh && child.material) {
        const applyToMat = (mat) => {
          if (!mat) return;
          if (!mat.userData) mat.userData = {};
          if (mat.userData.origTransparent === undefined) {
            mat.userData.origTransparent = mat.transparent;
            mat.userData.origOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
          }
          if (opacity < 0.999) {
            mat.transparent = true;
            mat.opacity = opacity;
            mat.depthWrite = false;
          } else {
            mat.transparent = mat.userData.origTransparent || false;
            mat.opacity = mat.userData.origOpacity !== undefined ? mat.userData.origOpacity : 1.0;
            mat.depthWrite = true;
          }
          mat.needsUpdate = true;
        };

        if (Array.isArray(child.material)) {
          child.material.forEach(applyToMat);
        } else {
          applyToMat(child.material);
        }
      }
    });
  }

  resetAllOpacities() {
    if (!this.model || !this.model.objects) return;
    for (const obj of this.model.objects) {
      this.setObjectOpacity(obj, 1.0);
    }
  }

  fitCameraToObject(modelObject) {
    if (!modelObject || !modelObject.object3d) return;
    fitCameraToSelection(this.camera, this.controls, [modelObject.object3d]);
  }

  getObjectProperties(modelObject) {
    if (!modelObject || !modelObject.object3d) return null;
    const box = new THREE.Box3().setFromObject(modelObject.object3d);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    let vertexCount = 0;
    let triangleCount = 0;
    let meshCount = 0;

    modelObject.object3d.traverse(child => {
      if (child.isMesh && child.geometry) {
        meshCount++;
        const geom = child.geometry;
        if (geom.index) {
          triangleCount += Math.floor(geom.index.count / 3);
        } else if (geom.attributes.position) {
          triangleCount += Math.floor(geom.attributes.position.count / 3);
        }
        if (geom.attributes.position) {
          vertexCount += geom.attributes.position.count;
        }
      }
    });

    const fcProperties = [];
    if (modelObject.properties) {
      try {
        if (typeof modelObject.properties.GetProperties === 'function') {
          const props = modelObject.properties.GetProperties();
          for (const p of props) {
            if (p && p.name) {
              fcProperties.push({ name: p.name, value: String(p.value) });
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    const color = modelObject.GetColor ? modelObject.GetColor() : null;
    const colorHex = color ? '#' + color.getHexString() : '#cccccc';

    return {
      name: modelObject.name || 'Pieza CAD',
      realName: modelObject.realName || '',
      uuid: modelObject.uuid,
      type: modelObject.GetType ? modelObject.GetType() : (modelObject.type || 'Shape'),
      sizeX: size.x,
      sizeY: size.y,
      sizeZ: size.z,
      centerX: center.x,
      centerY: center.y,
      centerZ: center.z,
      vertexCount,
      triangleCount,
      meshCount,
      visible: modelObject.GetVisibility ? modelObject.GetVisibility() : true,
      opacity: modelObject.opacityLevel !== undefined ? modelObject.opacityLevel : 1.0,
      colorHex,
      fcProperties
    };
  }

  destroy() {
    if (this.sectionTransformControl) {
      this.sectionTransformControl.detach();
      this.sectionTransformControl.dispose();
      this.sectionTransformControl = null;
    }
    if (this.sectionPlaneHandle && this.sectionPlaneHandle.parent) {
      this.sectionPlaneHandle.parent.remove(this.sectionPlaneHandle);
      this.sectionPlaneHandle = null;
    }
    if (this.viewport) {
      this.viewport.removeEventListener('pointerdown', this.onPointerDownHandler);
      this.viewport.removeEventListener('pointerup', this.onPointerUpHandler);
      this.viewport.removeEventListener('contextmenu', this.onContextMenuHandler);
    }
  }

  activateMeasurement(callback) {
    if (this.measurementTool) {
      this.measurementTool.activate(callback);
    }
  }

  deactivateMeasurement() {
    if (this.measurementTool) {
      this.measurementTool.deactivate();
    }
  }

  setMeasurementMode(mode) {
    if (this.measurementTool) {
      this.measurementTool.setMode(mode);
    }
  }

  resetMeasurement() {
    if (this.measurementTool) {
      this.measurementTool.reset();
    }
  }

  commitMeasurement() {
    if (this.measurementTool) {
      return this.measurementTool.commitCurrentMeasurement();
    }
    return null;
  }

  deleteMeasurement(id) {
    if (this.measurementTool) {
      this.measurementTool.deleteMeasurement(id);
    }
  }

  clearAllMeasurements() {
    if (this.measurementTool) {
      this.measurementTool.clearAllMeasurements();
    }
  }

  setKeepMeasurementsOnExit(enabled) {
    if (this.measurementTool) {
      this.measurementTool.setKeepMeasurementsOnExit(enabled);
    }
  }

  setDarkTheme(isDark) {
    this.isDarkTheme = !!isDark;
    if (this.measurementTool && typeof this.measurementTool.setDarkTheme === 'function') {
      this.measurementTool.setDarkTheme(isDark);
    }
  }

  initSectionAnalysis() {
    this.sectionActive = false;
    this.sectionAxis = 'z';
    this.sectionInvert = false;
    this.sectionOffset = 0;
    this.sectionShowPlane = true;
    this.sectionShowGizmo = true;
    this.sectionShowHatch = true;
    this.sectionHatchStyle = 'diagonal'; // 'diagonal', 'cross', 'solid'
    this.sectionHatchDensity = 1.0;
    this.sectionPaletteMode = 'pastel'; // 'pastel' (default) or 'vivid'
    this.sectionPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.customPlaneHelper = null;
    this.stencilGroup = null;
    this.capGroup = null;
    this.capMesh = null; // backward compatibility
    this.sharedCapGeometry = null;
    this.sectionCapMaterials = [];
    this._partIndexMap = new Map();
    this.sectionPlaneHandle = null;
    this.sectionTransformControl = null;
    this.onSectionChangeCallback = null;
    this._isDraggingSectionPlane = false;
    this._sectionCutEdges = null;
  }

  initPartIndexMap() {
    this._partIndexMap = new Map();
    if (!this.obj) return;
    this.obj.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        !child.userData.isStencilMesh &&
        !child.userData.isHelperMesh &&
        !child.userData.isCapMesh
      ) {
        const mo = this.findModelObjectForThreeObject(child);
        const key = mo ? mo.uuid : child.uuid;
        if (!this._partIndexMap.has(key)) {
          this._partIndexMap.set(key, this._partIndexMap.size);
        }
      }
    });
  }

  getModelBounds() {
    if (!this.obj) {
      return {
        min: { x: -50, y: -50, z: -50 },
        max: { x: 50, y: 50, z: 50 },
        center: { x: 0, y: 0, z: 0 },
        size: { x: 100, y: 100, z: 100 }
      };
    }
    const box = new THREE.Box3().setFromObject(this.obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
      center: { x: center.x, y: center.y, z: center.z },
      size: { x: size.x, y: size.y, z: size.z }
    };
  }

  getSectionPartColorInfo(partMo, partIndex, targetMesh = null) {
    const isPastel = (this.sectionPaletteMode !== 'vivid');
    const palettes = isPastel ? SECTION_PALETTES_PASTEL : SECTION_PALETTES_VIVID;
    const palette = palettes[partIndex % palettes.length];

    let customColor = null;

    // 1. Check if modelObject has an explicitly assigned color
    if (partMo && partMo.GetColor) {
      const c = partMo.GetColor();
      if (c && c.isColor) {
        const hsl = {};
        c.getHSL(hsl);
        // Only accept as custom CAD color if it has true chromatic saturation (> 0.18).
        // Neutral CAD grays/whites/silvers have saturation <= 0.15.
        if (hsl.s > 0.18 && hsl.l > 0.05 && hsl.l < 0.95) {
          customColor = c;
        }
      }
    }

    // 2. Fallback check mesh material color if modelObject had no custom color
    if (!customColor && targetMesh && targetMesh.material && targetMesh.material.color) {
      const c = targetMesh.material.color;
      if (c && c.isColor) {
        const hsl = {};
        c.getHSL(hsl);
        if (hsl.s > 0.18 && hsl.l > 0.05 && hsl.l < 0.95) {
          customColor = c;
        }
      }
    }

    if (customColor) {
      const hsl = {};
      customColor.getHSL(hsl);
      const angle = (partIndex % 2 === 0) ? Math.PI / 4 : (3 * Math.PI) / 4;
      if (isPastel) {
        // Washed pastel background: Lightness ~0.82, gentle saturation
        const bgCol = new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.55), 0.82);
        // Deep technical drafting ink line with matching hue: Lightness ~0.22, high contrast
        const lineCol = new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.80), 0.22);
        return {
          bgColor: bgCol,
          lineColor: lineCol,
          angle: angle
        };
      } else {
        const bgCol = new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.70), 0.65);
        const lineCol = new THREE.Color().setHSL(hsl.h, Math.max(hsl.s, 0.85), 0.18);
        return {
          bgColor: bgCol,
          lineColor: lineCol,
          angle: angle
        };
      }
    }

    return {
      bgColor: new THREE.Color(palette.bg),
      lineColor: new THREE.Color(palette.line),
      angle: palette.angle
    };
  }

  clearSectionCapsAndStencils() {
    if (this.stencilGroup) {
      this.scene.remove(this.stencilGroup);
      this.stencilGroup = null;
    }

    if (this.capGroup) {
      this.scene.remove(this.capGroup);
      if (this.sectionCapMaterials) {
        for (const mat of this.sectionCapMaterials) {
          mat.dispose();
        }
        this.sectionCapMaterials = [];
      }
      if (this.sharedCapGeometry) {
        this.sharedCapGeometry.dispose();
        this.sharedCapGeometry = null;
      }
      this.capGroup = null;
      this.capMesh = null;
    }

    if (this.renderer) {
      this.renderer.clearStencil();
    }
  }

  clearStencilMeshes() {
    this.clearSectionCapsAndStencils();
  }

  buildSectionCapsAndStencils() {
    this.clearSectionCapsAndStencils();
    if (!this.obj || !this.sectionActive) return;

    this.obj.updateMatrixWorld(true);

    // Group ONLY currently visible meshes by their part (modelObject or mesh uuid)
    const partMap = new Map();
    this.obj.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        !child.userData.isStencilMesh &&
        !child.userData.isHelperMesh &&
        !child.userData.isCapMesh
      ) {
        if (this.isMeshVisibleInView(child)) {
          const mo = this.findModelObjectForThreeObject(child);
          const key = mo ? mo.uuid : child.uuid;
          if (!partMap.has(key)) {
            partMap.set(key, { modelObject: mo, meshes: [] });
          }
          partMap.get(key).meshes.push(child);
        }
      }
    });

    if (partMap.size === 0) return;

    const bounds = this.getModelBounds();
    const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z) * 3 || 300;

    const baseSpacing = Math.max(3.0, Math.min(25.0, maxDim / 25.0));
    const uSpacing = Math.max(1.0, baseSpacing * (Number(this.sectionHatchDensity) || 1.0));
    const uLineWidth = Math.max(0.35, Math.min(1.6, uSpacing * 0.08));

    let styleFloat = 0.0;
    if (this.sectionHatchStyle === 'cross') styleFloat = 1.0;
    else if (this.sectionHatchStyle === 'solid') styleFloat = 2.0;

    this.stencilGroup = new THREE.Group();
    this.stencilGroup.name = 'sectionStencilGroup';

    this.capGroup = new THREE.Group();
    this.capGroup.name = 'sectionCapGroup';
    this.capMesh = this.capGroup; // backward compatibility

    this.sharedCapGeometry = new THREE.PlaneGeometry(maxDim, maxDim);
    this.sectionCapMaterials = [];

    // Shared stencil materials
    const baseMat = new THREE.MeshBasicMaterial();
    baseMat.depthWrite = false;
    baseMat.depthTest = false;
    baseMat.colorWrite = false;
    baseMat.stencilWrite = true;
    baseMat.stencilFunc = THREE.AlwaysStencilFunc;

    const stencilBackMat = baseMat.clone();
    stencilBackMat.side = THREE.BackSide;
    stencilBackMat.clippingPlanes = [ this.sectionPlane ];
    stencilBackMat.stencilFail = THREE.IncrementWrapStencilOp;
    stencilBackMat.stencilZFail = THREE.IncrementWrapStencilOp;
    stencilBackMat.stencilZPass = THREE.IncrementWrapStencilOp;

    const stencilFrontMat = baseMat.clone();
    stencilFrontMat.side = THREE.FrontSide;
    stencilFrontMat.clippingPlanes = [ this.sectionPlane ];
    stencilFrontMat.stencilFail = THREE.DecrementWrapStencilOp;
    stencilFrontMat.stencilZFail = THREE.DecrementWrapStencilOp;
    stencilFrontMat.stencilZPass = THREE.DecrementWrapStencilOp;

    if (!this._partIndexMap || this._partIndexMap.size === 0) {
      this.initPartIndexMap();
    }

    for (const [key, partData] of partMap.entries()) {
      const { modelObject, meshes } = partData;
      const stableIndex = this._partIndexMap.has(key) ? this._partIndexMap.get(key) : 0;
      const colorInfo = this.getSectionPartColorInfo(modelObject, stableIndex, meshes[0]);

      const stencilRenderOrder = 10 + stableIndex * 2;
      const capRenderOrder = 11 + stableIndex * 2;

      for (const mesh of meshes) {
        const mBack = new THREE.Mesh(mesh.geometry, stencilBackMat);
        mBack.matrix.copy(mesh.matrixWorld);
        mBack.matrixAutoUpdate = false;
        mBack.frustumCulled = false;
        mBack.renderOrder = stencilRenderOrder;
        mBack.userData.isStencilMesh = true;
        this.stencilGroup.add(mBack);

        const mFront = new THREE.Mesh(mesh.geometry, stencilFrontMat);
        mFront.matrix.copy(mesh.matrixWorld);
        mFront.matrixAutoUpdate = false;
        mFront.frustumCulled = false;
        mFront.renderOrder = stencilRenderOrder;
        mFront.userData.isStencilMesh = true;
        this.stencilGroup.add(mFront);
      }

      const capMat = new THREE.ShaderMaterial({
        vertexShader: HATCH_VERTEX_SHADER,
        fragmentShader: HATCH_FRAGMENT_SHADER,
        extensions: {
          derivatives: true
        },
        uniforms: {
          uBgColor: { value: colorInfo.bgColor },
          uLineColor: { value: colorInfo.lineColor },
          uAngle: { value: colorInfo.angle },
          uSpacing: { value: uSpacing },
          uLineWidth: { value: uLineWidth },
          uStyle: { value: styleFloat }
        },
        side: THREE.DoubleSide,
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
        depthWrite: true,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -0.5,
        polygonOffsetUnits: -0.5
      });

      this.sectionCapMaterials.push(capMat);

      const capMesh = new THREE.Mesh(this.sharedCapGeometry, capMat);
      capMesh.renderOrder = capRenderOrder;
      capMesh.frustumCulled = false;
      capMesh.userData.isCapMesh = true;
      capMesh.userData.modelObject = modelObject;
      capMesh.userData.targetMesh = meshes[0];
      capMesh.onAfterRender = (renderer) => {
        renderer.clearStencil();
      };

      this.capGroup.add(capMesh);
    }

    this.scene.add(this.stencilGroup);
    this.scene.add(this.capGroup);
    this.updateCapMeshTransform();

    if (this.capGroup) {
      this.capGroup.visible = !!this.sectionShowHatch;
    }
    if (this.stencilGroup) {
      this.stencilGroup.visible = !!this.sectionShowHatch;
    }
  }

  rebuildSectionCaps() {
    if (!this.sectionActive) return;
    this.buildSectionCapsAndStencils();
  }

  updateSectionHatchUniforms(maxDim) {
    if (!this.sectionCapMaterials || this.sectionCapMaterials.length === 0) return;
    const baseSpacing = Math.max(3.0, Math.min(25.0, (maxDim || 300) / 25.0));
    const uSpacing = Math.max(1.0, baseSpacing * (Number(this.sectionHatchDensity) || 1.0));
    const uLineWidth = Math.max(0.35, Math.min(1.6, uSpacing * 0.08));

    let styleFloat = 0.0;
    if (this.sectionHatchStyle === 'cross') styleFloat = 1.0;
    else if (this.sectionHatchStyle === 'solid') styleFloat = 2.0;

    for (const mat of this.sectionCapMaterials) {
      if (mat.uniforms) {
        if (mat.uniforms.uSpacing) mat.uniforms.uSpacing.value = uSpacing;
        if (mat.uniforms.uLineWidth) mat.uniforms.uLineWidth.value = uLineWidth;
        if (mat.uniforms.uStyle) mat.uniforms.uStyle.value = styleFloat;
      }
    }
  }

  updateCapMeshTransform() {
    if (!this.capGroup || !this.sectionPlane) return;
    const bounds = this.getModelBounds();
    if (this.sectionAxis === 'x') {
      this.capGroup.position.set(this.sectionOffset, bounds.center.y, bounds.center.z);
    } else if (this.sectionAxis === 'y') {
      this.capGroup.position.set(bounds.center.x, this.sectionOffset, bounds.center.z);
    } else {
      this.capGroup.position.set(bounds.center.x, bounds.center.y, this.sectionOffset);
    }
    const target = this.capGroup.position.clone().sub(this.sectionPlane.normal);
    if (Math.abs(this.sectionPlane.normal.y) > 0.9) {
      this.capGroup.up.set(0, 0, 1);
    } else {
      this.capGroup.up.set(0, 1, 0);
    }
    this.capGroup.lookAt(target);
  }

  buildCustomPlaneHelper(maxDim) {
    if (this.customPlaneHelper) {
      this.scene.remove(this.customPlaneHelper);
      this.customPlaneHelper = null;
    }

    const group = new THREE.Group();
    group.name = 'customSectionPlaneHelper';

    // 1. Translucent Plane Quad (no clipping, depthWrite: false -> ZERO flickering!)
    const planeGeom = new THREE.PlaneGeometry(maxDim, maxDim);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x00bcd4,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const planeMesh = new THREE.Mesh(planeGeom, planeMat);
    planeMesh.renderOrder = 998;
    planeMesh.userData.isHelperMesh = true;
    group.add(planeMesh);

    // 2. High-visibility crisp border frame and center cross
    const hw = maxDim / 2;
    const hh = maxDim / 2;
    const ch = maxDim * 0.08;
    const borderVerts = new Float32Array([
      // Outer rectangle frame
      -hw, -hh, 0,   hw, -hh, 0,
       hw, -hh, 0,   hw,  hh, 0,
       hw,  hh, 0,  -hw,  hh, 0,
      -hw,  hh, 0,  -hw, -hh, 0,
      // Center crosshair
      -ch, 0, 0,   ch, 0, 0,
      0, -ch, 0,   0,  ch, 0
    ]);
    const borderGeom = new THREE.BufferGeometry();
    borderGeom.setAttribute('position', new THREE.BufferAttribute(borderVerts, 3));
    const borderMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff,
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    const borderLines = new THREE.LineSegments(borderGeom, borderMat);
    borderLines.renderOrder = 999;
    borderLines.userData.isHelperMesh = true;
    group.add(borderLines);

    this.customPlaneHelper = group;
  }

  updateCustomPlaneHelperTransform() {
    if (!this.customPlaneHelper || !this.sectionPlane) return;
    const bounds = this.getModelBounds();
    if (this.sectionAxis === 'x') {
      this.customPlaneHelper.position.set(this.sectionOffset, bounds.center.y, bounds.center.z);
    } else if (this.sectionAxis === 'y') {
      this.customPlaneHelper.position.set(bounds.center.x, this.sectionOffset, bounds.center.z);
    } else {
      this.customPlaneHelper.position.set(bounds.center.x, bounds.center.y, this.sectionOffset);
    }
    const target = this.customPlaneHelper.position.clone().sub(this.sectionPlane.normal);
    if (Math.abs(this.sectionPlane.normal.y) > 0.9) {
      this.customPlaneHelper.up.set(0, 0, 1);
    } else {
      this.customPlaneHelper.up.set(0, 1, 0);
    }
    this.customPlaneHelper.lookAt(target);
  }

  customizeSectionGizmoToUnidirectional() {
    if (!this.sectionTransformControl) return;

    const g = this.sectionTransformControl._gizmo || this.sectionTransformControl;
    const gizmoTranslate = (g.gizmo && g.gizmo.translate) || (this.sectionTransformControl.gizmo && this.sectionTransformControl.gizmo.translate);
    const pickerTranslate = (g.picker && g.picker.translate) || (this.sectionTransformControl.picker && this.sectionTransformControl.picker.translate);
    const helperTranslate = (g.helper && g.helper.translate) || (this.sectionTransformControl.helper && this.sectionTransformControl.helper.translate);

    // 1. Remove opposing/negative arrow cones (TransformControls creates bidirectional cones by default)
    if (gizmoTranslate && gizmoTranslate.children) {
      const toRemove = [];
      for (const ch of gizmoTranslate.children) {
        if (ch.geometry) {
          ch.geometry.computeBoundingBox();
          const bb = ch.geometry.boundingBox;
          if (bb) {
            if (
              (ch.name === 'X' && bb.max.x < 0) ||
              (ch.name === 'Y' && bb.max.y < 0) ||
              (ch.name === 'Z' && bb.max.z < 0)
            ) {
              toRemove.push(ch);
            }
          }
        }
      }
      for (const ch of toRemove) {
        gizmoTranslate.remove(ch);
      }
    }

    // 2. Remove negative pickers so the hidden side is not hovered or grabbed accidentally
    if (pickerTranslate && pickerTranslate.children) {
      const toRemovePicker = [];
      for (const ch of pickerTranslate.children) {
        if (ch.geometry) {
          ch.geometry.computeBoundingBox();
          const bb = ch.geometry.boundingBox;
          if (bb) {
            if (
              (ch.name === 'X' && bb.max.x <= 0) ||
              (ch.name === 'Y' && bb.max.y <= 0) ||
              (ch.name === 'Z' && bb.max.z <= 0)
            ) {
              toRemovePicker.push(ch);
            }
          }
        }
      }
      for (const ch of toRemovePicker) {
        pickerTranslate.remove(ch);
      }
    }

    // 3. Clear infinite helper axis lines that span through the entire viewport
    if (helperTranslate && typeof helperTranslate.clear === 'function') {
      helperTranslate.clear();
    } else if (helperTranslate && helperTranslate.children) {
      while (helperTranslate.children.length > 0) {
        helperTranslate.remove(helperTranslate.children[0]);
      }
    }
  }

  initSectionGizmo() {
    if (this.sectionTransformControl) return;

    this.sectionPlaneHandle = new THREE.Object3D();
    this.sectionPlaneHandle.name = 'sectionPlaneHandle';
    this.scene.add(this.sectionPlaneHandle);

    this.sectionTransformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.sectionTransformControl.size = 0.85;
    this.sectionTransformControl.setMode('translate');
    this.sectionTransformControl.setSpace('local');

    this.customizeSectionGizmoToUnidirectional();

    this.sectionTransformControl.attach(this.sectionPlaneHandle);

    this.sectionTransformControl.addEventListener('dragging-changed', (event) => {
      this._isDraggingSectionPlane = !!event.value;
      if (this.controls) {
        this.controls.enabled = !event.value;
      }
      if (!event.value) {
        setTimeout(() => {
          this._isDraggingSectionPlane = false;
        }, 80);
      }
    });

    this.sectionTransformControl.addEventListener('change', () => {
      if (!this._isDraggingSectionPlane || !this.sectionActive) return;

      const bounds = this.getModelBounds();
      let newOffset = 0;

      if (this.sectionAxis === 'x') {
        const minX = bounds.min.x;
        const maxX = bounds.max.x;
        const padX = ((maxX - minX) || 100) * 0.1;
        newOffset = Math.max(minX - padX, Math.min(maxX + padX, this.sectionPlaneHandle.position.x));
        this.sectionPlaneHandle.position.set(newOffset, bounds.center.y, bounds.center.z);
      } else if (this.sectionAxis === 'y') {
        const minY = bounds.min.y;
        const maxY = bounds.max.y;
        const padY = ((maxY - minY) || 100) * 0.1;
        newOffset = Math.max(minY - padY, Math.min(maxY + padY, this.sectionPlaneHandle.position.y));
        this.sectionPlaneHandle.position.set(bounds.center.x, newOffset, bounds.center.z);
      } else {
        const minZ = bounds.min.z;
        const maxZ = bounds.max.z;
        const padZ = ((maxZ - minZ) || 100) * 0.1;
        newOffset = Math.max(minZ - padZ, Math.min(maxZ + padZ, this.sectionPlaneHandle.position.z));
        this.sectionPlaneHandle.position.set(bounds.center.x, bounds.center.y, newOffset);
      }

      this.sectionOffset = newOffset;

      const normal = new THREE.Vector3();
      if (this.sectionAxis === 'x') normal.set(this.sectionInvert ? 1 : -1, 0, 0);
      else if (this.sectionAxis === 'y') normal.set(0, this.sectionInvert ? 1 : -1, 0);
      else normal.set(0, 0, this.sectionInvert ? 1 : -1);

      const constant = this.sectionInvert ? -this.sectionOffset : this.sectionOffset;
      this.sectionPlane.set(normal, constant);
      this._sectionCutEdges = null;

      this.updateCapMeshTransform();
      this.updateCustomPlaneHelperTransform();

      if (this.measurementTool && typeof this.measurementTool.updateSectionClipping === 'function') {
        this.measurementTool.updateSectionClipping();
      }

      if (this.onSectionChangeCallback) {
        this.onSectionChangeCallback({
          axis: this.sectionAxis,
          offset: this.sectionOffset,
          invert: this.sectionInvert
        });
      }
    });

    const gizmoObj = this.sectionTransformControl.isObject3D
      ? this.sectionTransformControl
      : (this.sectionTransformControl.getHelper ? this.sectionTransformControl.getHelper() : this.sectionTransformControl);
    gizmoObj.name = 'sectionTransformGizmo';
    this.scene.add(gizmoObj);
  }

  updateSectionGizmoTransform() {
    if (!this.sectionPlaneHandle || !this.sectionTransformControl) return;

    const bounds = this.getModelBounds();
    const cx = bounds.center.x;
    const cy = bounds.center.y;
    const cz = bounds.center.z;

    if (this.sectionAxis === 'x') {
      this.sectionPlaneHandle.position.set(this.sectionOffset, cy, cz);
      this.sectionTransformControl.showX = true;
      this.sectionTransformControl.showY = false;
      this.sectionTransformControl.showZ = false;
    } else if (this.sectionAxis === 'y') {
      this.sectionPlaneHandle.position.set(cx, this.sectionOffset, cz);
      this.sectionTransformControl.showX = false;
      this.sectionTransformControl.showY = true;
      this.sectionTransformControl.showZ = false;
    } else {
      this.sectionPlaneHandle.position.set(cx, cy, this.sectionOffset);
      this.sectionTransformControl.showX = false;
      this.sectionTransformControl.showY = false;
      this.sectionTransformControl.showZ = true;
    }

    if (this.sectionInvert) {
      if (this.sectionAxis === 'x') {
        this.sectionPlaneHandle.rotation.set(0, Math.PI, 0);
      } else if (this.sectionAxis === 'y') {
        this.sectionPlaneHandle.rotation.set(0, 0, Math.PI);
      } else {
        this.sectionPlaneHandle.rotation.set(Math.PI, 0, 0);
      }
    } else {
      this.sectionPlaneHandle.rotation.set(0, 0, 0);
    }
    this.sectionPlaneHandle.updateMatrixWorld(true);

    const gizmoObj = this.sectionTransformControl.isObject3D
      ? this.sectionTransformControl
      : (this.sectionTransformControl.getHelper ? this.sectionTransformControl.getHelper() : this.sectionTransformControl);

    const shouldShow = !!(this.sectionActive && this.sectionShowGizmo);
    gizmoObj.visible = shouldShow;
    this.sectionTransformControl.enabled = shouldShow;
  }

  setSectionAnalysis({
    active,
    axis,
    offset,
    invert,
    showPlane,
    showGizmo,
    showHatch,
    hatchStyle,
    hatchDensity,
    paletteMode
  }) {
    if (active !== undefined) this.sectionActive = active;
    if (axis !== undefined) this.sectionAxis = axis;
    if (offset !== undefined) this.sectionOffset = offset;
    if (invert !== undefined) this.sectionInvert = invert;
    if (showPlane !== undefined) this.sectionShowPlane = showPlane;
    if (showGizmo !== undefined) this.sectionShowGizmo = showGizmo;
    if (showHatch !== undefined) this.sectionShowHatch = showHatch;

    let rebuildCaps = false;
    if (paletteMode !== undefined && this.sectionPaletteMode !== paletteMode) {
      this.sectionPaletteMode = paletteMode;
      rebuildCaps = true;
    }

    let hatchChanged = false;
    if (hatchStyle !== undefined && this.sectionHatchStyle !== hatchStyle) {
      this.sectionHatchStyle = hatchStyle;
      hatchChanged = true;
    }
    if (hatchDensity !== undefined && this.sectionHatchDensity !== hatchDensity) {
      this.sectionHatchDensity = hatchDensity;
      hatchChanged = true;
    }

    if (!this.sectionPlane) {
      this.initSectionAnalysis();
    }

    const normal = new THREE.Vector3();
    if (this.sectionAxis === 'x') normal.set(this.sectionInvert ? 1 : -1, 0, 0);
    else if (this.sectionAxis === 'y') normal.set(0, this.sectionInvert ? 1 : -1, 0);
    else normal.set(0, 0, this.sectionInvert ? 1 : -1);

    const constant = this.sectionInvert ? -this.sectionOffset : this.sectionOffset;
    this.sectionPlane.set(normal, constant);
    this._sectionCutEdges = null;

    if (this.sectionActive) {
      // Local clipping on model meshes: renderer.clippingPlanes stays empty to prevent helper flickering!
      this.renderer.clippingPlanes = [];

      if (this.obj) {
        this.obj.traverse((child) => {
          if (
            child instanceof THREE.Mesh &&
            !child.userData.isStencilMesh &&
            !child.userData.isHelperMesh &&
            !child.userData.isCapMesh
          ) {
            child.material.clippingPlanes = [ this.sectionPlane ];
            child.material.side = THREE.DoubleSide;
            child.material.clipShadows = true;
            child.renderOrder = 3;
            child.material.needsUpdate = true;
          }
        });
      }

      if (this.lineSegments) {
        this.lineSegments.traverse((child) => {
          if (child instanceof THREE.LineSegments && child.material) {
            child.material.clippingPlanes = [ this.sectionPlane ];
            child.renderOrder = 4;
            child.material.needsUpdate = true;
          }
        });
      }

      const bounds = this.getModelBounds();
      const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z) * 3 || 300;

      // 1. Stencils and Caps
      if (!this.capGroup || !this.stencilGroup || rebuildCaps) {
        this.buildSectionCapsAndStencils();
      } else if (hatchChanged) {
        this.updateSectionHatchUniforms(maxDim);
      }
      this.updateCapMeshTransform();

      if (this.capGroup) {
        this.capGroup.visible = !!this.sectionShowHatch;
      }
      if (this.stencilGroup) {
        this.stencilGroup.visible = !!this.sectionShowHatch;
      }

      // 2. Flicker-free 3D guide plane helper
      if (!this.customPlaneHelper) {
        this.buildCustomPlaneHelper(maxDim * 0.7);
      }
      this.updateCustomPlaneHelperTransform();

      if (this.sectionShowPlane) {
        if (!this.scene.children.includes(this.customPlaneHelper)) {
          this.scene.add(this.customPlaneHelper);
        }
      } else if (this.customPlaneHelper) {
        this.scene.remove(this.customPlaneHelper);
      }

      // 3. Interactive 3D section plane Gizmo
      if (!this.sectionTransformControl) {
        this.initSectionGizmo();
      }
      if (!this._isDraggingSectionPlane) {
        this.updateSectionGizmoTransform();
      }

    } else {
      // Deactivate section analysis
      this.renderer.clippingPlanes = [];

      if (this.obj) {
        this.obj.traverse((child) => {
          if (
            child instanceof THREE.Mesh &&
            !child.userData.isStencilMesh &&
            !child.userData.isHelperMesh &&
            !child.userData.isCapMesh
          ) {
            child.material.clippingPlanes = [];
            child.renderOrder = 0;
            child.material.needsUpdate = true;
          }
        });
      }

      if (this.lineSegments) {
        this.lineSegments.traverse((child) => {
          if (child instanceof THREE.LineSegments && child.material) {
            child.material.clippingPlanes = [];
            child.renderOrder = 0;
            child.material.needsUpdate = true;
          }
        });
      }

      this.clearSectionCapsAndStencils();

      if (this.customPlaneHelper) {
        this.scene.remove(this.customPlaneHelper);
        this.customPlaneHelper = null;
      }

      if (this.sectionTransformControl) {
        this.updateSectionGizmoTransform();
      }

      if (this.renderer) {
        this.renderer.clearStencil();
      }
      this._sectionCutEdges = null;
    }

    if (this.measurementTool && typeof this.measurementTool.updateSectionClipping === 'function') {
      this.measurementTool.updateSectionClipping();
    }
  }

  /**
   * Calculates and returns all 3D cut perimeter edges (aristas de corte/sección)
   * produced dynamically where the cutting plane intersects the visible 3D meshes.
   * Results are cached until the section plane offset, axis, or inversion changes.
   */
  getSectionCutEdges() {
    if (!this.sectionActive || !this.sectionPlane || !this.obj) return [];
    if (this._sectionCutEdges !== null) {
      return this._sectionCutEdges;
    }

    const plane = this.sectionPlane;
    const normal = plane.normal;
    const constant = plane.constant;
    const eps = 1e-4;

    const visibleMeshes = [];
    this.obj.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        !child.userData.isStencilMesh &&
        !child.userData.isHelperMesh &&
        !child.userData.isCapMesh
      ) {
        if (!this.isMeshVisibleInView || this.isMeshVisibleInView(child)) {
          visibleMeshes.push(child);
        }
      }
    });

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const factor = 1000;
    const keyOf = (p) => `${Math.round(p.x * factor)}_${Math.round(p.y * factor)}_${Math.round(p.z * factor)}`;

    const allCutEdges = [];

    for (let m = 0; m < visibleMeshes.length; m++) {
      const mesh = visibleMeshes[m];
      const geom = mesh.geometry;
      if (!geom || !geom.attributes || !geom.attributes.position) continue;

      mesh.updateMatrixWorld(true);
      if (!geom.boundingBox) geom.computeBoundingBox();
      if (geom.boundingBox) {
        const worldBox = geom.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
        if (!plane.intersectsBox(worldBox)) {
          continue;
        }
      }

      const pos = geom.attributes.position;
      const index = geom.index;
      const triCount = index ? index.count / 3 : pos.count / 3;
      const matrixWorld = mesh.matrixWorld;

      const rawSegments = [];
      const seenEdges = new Set();

      for (let i = 0; i < triCount; i++) {
        const ia = index ? index.getX(i * 3) : i * 3;
        const ib = index ? index.getX(i * 3 + 1) : i * 3 + 1;
        const ic = index ? index.getX(i * 3 + 2) : i * 3 + 2;

        vA.fromBufferAttribute(pos, ia).applyMatrix4(matrixWorld);
        vB.fromBufferAttribute(pos, ib).applyMatrix4(matrixWorld);
        vC.fromBufferAttribute(pos, ic).applyMatrix4(matrixWorld);

        const dA = normal.dot(vA) + constant;
        const dB = normal.dot(vB) + constant;
        const dC = normal.dot(vC) + constant;

        const signA = Math.abs(dA) <= eps ? 0 : (dA > 0 ? 1 : -1);
        const signB = Math.abs(dB) <= eps ? 0 : (dB > 0 ? 1 : -1);
        const signC = Math.abs(dC) <= eps ? 0 : (dC > 0 ? 1 : -1);

        if ((signA > 0 && signB > 0 && signC > 0) || (signA < 0 && signB < 0 && signC < 0)) continue;
        if (signA === 0 && signB === 0 && signC === 0) continue;

        let res = null;
        if (signA === 0 && signB === 0) res = [vA.clone(), vB.clone()];
        else if (signB === 0 && signC === 0) res = [vB.clone(), vC.clone()];
        else if (signC === 0 && signA === 0) res = [vC.clone(), vA.clone()];
        else if ((signA === 0 && signB === signC) || (signB === 0 && signA === signC) || (signC === 0 && signA === signB)) {
          continue;
        } else {
          const pts = [];
          const checkEdge = (p1, p2, d1, d2) => {
            if ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) {
              const t = -d1 / (d2 - d1);
              pts.push(new THREE.Vector3().lerpVectors(p1, p2, t));
            } else if (Math.abs(d1) <= eps) {
              pts.push(p1.clone());
            }
          };
          checkEdge(vA, vB, dA, dB);
          checkEdge(vB, vC, dB, dC);
          checkEdge(vC, vA, dC, dA);

          const unique = [];
          for (let k = 0; k < pts.length; k++) {
            const p = pts[k];
            if (!unique.some(u => u.distanceToSquared(p) < 1e-6)) {
              unique.push(p);
            }
          }
          if (unique.length === 2) res = unique;
        }

        if (res && res.length === 2) {
          const k1 = keyOf(res[0]);
          const k2 = keyOf(res[1]);
          if (k1 === k2) continue;
          const ek = k1 < k2 ? `${k1}__${k2}` : `${k2}__${k1}`;
          if (!seenEdges.has(ek)) {
            seenEdges.add(ek);
            rawSegments.push({ p1: res[0], p2: res[1], mesh: mesh });
          }
        }
      }

      if (rawSegments.length > 0) {
        const mergedForMesh = this._mergeCollinearCutSegments(rawSegments, mesh);
        allCutEdges.push(...mergedForMesh);
      }
    }

    this._sectionCutEdges = allCutEdges;
    return allCutEdges;
  }

  _mergeCollinearCutSegments(segs, mesh) {
    if (!segs || segs.length === 0) return [];

    const factor = 1000;
    const keyOf = (p) => `${Math.round(p.x * factor)}_${Math.round(p.y * factor)}_${Math.round(p.z * factor)}`;

    const nodeMap = new Map();
    const nodes = [];

    function getOrCreateNode(p) {
      const k = keyOf(p);
      if (nodeMap.has(k)) return nodeMap.get(k).id;
      const id = nodes.length;
      nodes.push(p);
      nodeMap.set(k, { id, pt: p });
      return id;
    }

    const adj = new Map();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const id1 = getOrCreateNode(s.p1);
      const id2 = getOrCreateNode(s.p2);
      if (id1 === id2) continue;
      if (!adj.has(id1)) adj.set(id1, new Set());
      if (!adj.has(id2)) adj.set(id2, new Set());
      adj.get(id1).add(id2);
      adj.get(id2).add(id1);
    }

    const visitedEdges = new Set();
    const edgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

    function getEdgePath(startNode, nextNode) {
      const path = [startNode, nextNode];
      visitedEdges.add(edgeKey(startNode, nextNode));
      let prev = startNode;
      let curr = nextNode;
      while (true) {
        const neighbors = Array.from(adj.get(curr) || []).filter(n => n !== prev && !visitedEdges.has(edgeKey(curr, n)));
        if (neighbors.length === 1 && adj.get(curr).size === 2) {
          const next = neighbors[0];
          visitedEdges.add(edgeKey(curr, next));
          path.push(next);
          prev = curr;
          curr = next;
          if (curr === startNode) break;
        } else {
          break;
        }
      }
      return path;
    }

    const paths = [];
    for (const [node, neighbors] of adj.entries()) {
      if (neighbors.size !== 2) {
        for (const n of neighbors) {
          if (!visitedEdges.has(edgeKey(node, n))) {
            paths.push(getEdgePath(node, n));
          }
        }
      }
    }
    for (const [node, neighbors] of adj.entries()) {
      for (const n of neighbors) {
        if (!visitedEdges.has(edgeKey(node, n))) {
          paths.push(getEdgePath(node, n));
        }
      }
    }

    const resultEdges = [];
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p];
      if (path.length < 2) continue;
      const isClosed = (path[0] === path[path.length - 1]) && path.length > 2;

      let pStart = nodes[path[0]];
      let pPrev = nodes[path[1]];
      let dir = new THREE.Vector3().subVectors(pPrev, pStart).normalize();

      const pathEdges = [];

      for (let i = 2; i < path.length; i++) {
        const pCurr = nodes[path[i]];
        const curDir = new THREE.Vector3().subVectors(pCurr, pPrev).normalize();
        if (dir.dot(curDir) > 0.999) {
          pPrev = pCurr;
        } else {
          const len = pStart.distanceTo(pPrev);
          if (len > 0.05) {
            const edgeDir = new THREE.Vector3().subVectors(pPrev, pStart).normalize();
            pathEdges.push({
              p1: pStart.clone(),
              p2: pPrev.clone(),
              length: len,
              direction: edgeDir,
              midpoint: new THREE.Vector3().addVectors(pStart, pPrev).multiplyScalar(0.5),
              mesh: mesh,
              isCutEdge: true
            });
          }
          pStart = pPrev;
          pPrev = pCurr;
          dir = curDir;
        }
      }

      const len = pStart.distanceTo(pPrev);
      if (len > 0.05) {
        const edgeDir = new THREE.Vector3().subVectors(pPrev, pStart).normalize();
        pathEdges.push({
          p1: pStart.clone(),
          p2: pPrev.clone(),
          length: len,
          direction: edgeDir,
          midpoint: new THREE.Vector3().addVectors(pStart, pPrev).multiplyScalar(0.5),
          mesh: mesh,
          isCutEdge: true
        });
      }

      if (isClosed && pathEdges.length > 1) {
        const first = pathEdges[0];
        const last = pathEdges[pathEdges.length - 1];
        if (Math.abs(first.direction.dot(last.direction)) > 0.999) {
          last.p2 = first.p2.clone();
          last.length = last.p1.distanceTo(last.p2);
          last.midpoint = new THREE.Vector3().addVectors(last.p1, last.p2).multiplyScalar(0.5);
          pathEdges.shift();
        }
      }

      resultEdges.push(...pathEdges);
    }

    // Fallback for unvisited single segments
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const id1 = getOrCreateNode(s.p1);
      const id2 = getOrCreateNode(s.p2);
      if (id1 !== id2 && !visitedEdges.has(edgeKey(id1, id2))) {
        const len = s.p1.distanceTo(s.p2);
        if (len > 0.05) {
          resultEdges.push({
            p1: s.p1.clone(),
            p2: s.p2.clone(),
            length: len,
            direction: new THREE.Vector3().subVectors(s.p2, s.p1).normalize(),
            midpoint: new THREE.Vector3().addVectors(s.p1, s.p2).multiplyScalar(0.5),
            mesh: mesh,
            isCutEdge: true
          });
        }
      }
    }

    return resultEdges;
  }
}

