<!--
SPDX-FileCopyrightText: 2024 Ondsel <development@ondsel.com>

SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
  <div class="model-viewer-root" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
    <div ref="modelViewer" style="width: 100%; height: 100%; display: block;" />

    <!-- Floating Action Buttons on 3D Viewport -->
    <div
      v-if="isLoaded"
      style="position: absolute; bottom: 24px; left: 24px; z-index: 10;"
      class="d-flex align-center"
    >
      <!-- Section Cut Button -->
      <v-btn
        :color="sectionActive ? 'primary' : undefined"
        variant="elevated"
        icon
        size="large"
        elevation="4"
        class="mr-2"
        :style="!sectionActive ? 'background-color: rgba(var(--v-theme-surface), 0.95); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.15);' : ''"
        @click="toggleSection"
      >
        <v-icon :color="sectionActive ? undefined : 'on-surface'">mdi-vector-intersection</v-icon>
        <v-tooltip activator="parent" location="top">
          {{ !sectionActive ? 'Activate section analysis (3D Cross-Sections)' : (sectionPanelOpen ? 'Hide section panel' : 'Open section controls (Active cut)') }}
        </v-tooltip>
      </v-btn>

      <!-- Navigation Style Menu Button (FreeCAD Touchpad / Orbit / CAD / Blender) -->
      <v-menu
        v-model="navMenuOpen"
        location="top start"
        :close-on-content-click="false"
        transition="slide-y-reverse-transition"
      >
        <template v-slot:activator="{ props }">
          <v-btn
            v-bind="props"
            variant="elevated"
            icon
            size="large"
            elevation="4"
            class="mr-2"
            :style="'background-color: rgba(var(--v-theme-surface), 0.95); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.15);'"
          >
            <v-icon :color="'on-surface'">
              {{ navigationStyle === 'touchpad' ? 'mdi-laptop' : (navigationStyle === 'cad' ? 'mdi-cube-outline' : (navigationStyle === 'blender' ? 'mdi-blender-software' : 'mdi-axis-arrow')) }}
            </v-icon>
            <v-tooltip activator="parent" location="top">
              3D Navigation: {{ navStyleTitle }} (click to change style)
            </v-tooltip>
          </v-btn>
        </template>

        <v-card width="340" class="pa-2" elevation="8" rounded="lg" style="backdrop-filter: blur(12px); background-color: rgba(var(--v-theme-surface), 0.98);">
          <div class="px-3 pt-2 pb-1 d-flex align-center justify-space-between">
            <div class="d-flex align-center">
              <v-icon size="small" class="mr-2" color="primary">mdi-cursor-move</v-icon>
              <span class="text-subtitle-2 font-weight-bold">3D Navigation Style</span>
            </div>
            <v-btn icon="mdi-close" variant="text" size="x-small" @click="navMenuOpen = false" />
          </div>
          <div class="px-3 pb-2 text-caption text-medium-emphasis">
            Select camera navigation mode (FreeCAD style)
          </div>

          <v-divider class="mb-1" />

          <v-list density="compact" nav class="pa-1">
            <!-- 1. Touchpad (FreeCAD) -->
            <v-list-item
              :active="navigationStyle === 'touchpad'"
              color="primary"
              rounded="md"
              class="mb-1"
              @click="setNavStyle('touchpad')"
            >
              <template v-slot:prepend>
                <v-icon :color="navigationStyle === 'touchpad' ? 'primary' : undefined">mdi-laptop</v-icon>
              </template>
              <v-list-item-title class="font-weight-bold text-body-2 d-flex align-center justify-space-between">
                <span>Touchpad (FreeCAD)</span>
                <v-chip size="x-small" color="primary" variant="tonal" class="ml-2 font-weight-bold">Recommended</v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption mt-1" style="line-height: 1.35; white-space: normal;">
                <span class="font-weight-medium text-primary">Shift + Drag:</span> Pan<br/>
                <span class="font-weight-medium text-primary">Alt + Drag:</span> Orbit (Rotate)<br/>
                <span class="text-medium-emphasis">Wheel: Zoom | Click: Select / Measure</span>
              </v-list-item-subtitle>
            </v-list-item>

            <!-- 2. Standard (Three.js) -->
            <v-list-item
              :active="navigationStyle === 'orbit'"
              color="primary"
              rounded="md"
              class="mb-1"
              @click="setNavStyle('orbit')"
            >
              <template v-slot:prepend>
                <v-icon :color="navigationStyle === 'orbit' ? 'primary' : undefined">mdi-axis-arrow</v-icon>
              </template>
              <v-list-item-title class="font-weight-medium text-body-2">
                Standard / Orbit (Three.js)
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption mt-1" style="line-height: 1.35; white-space: normal;">
                <span class="font-weight-medium">Left Drag:</span> Orbit (Rotate)<br/>
                <span class="font-weight-medium">Shift or Right Drag:</span> Pan<br/>
                <span class="text-medium-emphasis">Wheel: Zoom | Click: Select</span>
              </v-list-item-subtitle>
            </v-list-item>

            <!-- 3. CAD (FreeCAD / OpenCASCADE) -->
            <v-list-item
              :active="navigationStyle === 'cad'"
              color="primary"
              rounded="md"
              class="mb-1"
              @click="setNavStyle('cad')"
            >
              <template v-slot:prepend>
                <v-icon :color="navigationStyle === 'cad' ? 'primary' : undefined">mdi-cube-outline</v-icon>
              </template>
              <v-list-item-title class="font-weight-medium text-body-2">
                CAD (FreeCAD / OpenCASCADE)
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption mt-1" style="line-height: 1.35; white-space: normal;">
                <span class="font-weight-medium">Middle Button:</span> Pan<br/>
                <span class="font-weight-medium">Middle + Left Click:</span> Orbit (Rotate)<br/>
                <span class="text-medium-emphasis">Wheel: Zoom | Left Click: Select</span>
              </v-list-item-subtitle>
            </v-list-item>

            <!-- 4. Blender -->
            <v-list-item
              :active="navigationStyle === 'blender'"
              color="primary"
              rounded="md"
              @click="setNavStyle('blender')"
            >
              <template v-slot:prepend>
                <v-icon :color="navigationStyle === 'blender' ? 'primary' : undefined">mdi-blender-software</v-icon>
              </template>
              <v-list-item-title class="font-weight-medium text-body-2">
                Blender
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption mt-1" style="line-height: 1.35; white-space: normal;">
                <span class="font-weight-medium">Middle Button:</span> Orbit (Rotate)<br/>
                <span class="font-weight-medium">Shift + Middle:</span> Pan<br/>
                <span class="text-medium-emphasis">Wheel: Zoom | Left Click: Select</span>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-menu>

      <!-- Measurement Tool Button -->
      <v-btn
        :color="measureActive ? 'primary' : undefined"
        variant="elevated"
        icon
        size="large"
        elevation="4"
        :style="!measureActive ? 'background-color: rgba(var(--v-theme-surface), 0.95); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.15);' : ''"
        @click="toggleMeasurement"
      >
        <v-icon :color="measureActive ? undefined : 'on-surface'">mdi-ruler-square</v-icon>
        <v-tooltip activator="parent" location="top">
          {{ !measureActive ? 'CAD measurement tool (Planes, Radii, Edges)' : (measurePanelOpen ? 'Hide measurement panel' : 'Open measurement panel (Active)') }}
        </v-tooltip>
      </v-btn>
    </div>

    <!-- 3D Floating Measurement Badges & SVG Leader Lines -->
    <div
      v-if="measurementBadges && measurementBadges.length > 0"
      class="measurement-badges-container"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden; z-index: 12;"
    >
      <!-- SVG leader lines connecting 3D anchor points to displaced badges -->
      <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
        <defs>
          <filter id="badge-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" :flood-color="isDark ? '#000000' : '#ffffff'" flood-opacity="0.8"/>
          </filter>
        </defs>
        <g v-for="badge in measurementBadges" :key="'svg-' + badge.id">
          <line
            :id="'badge-line-' + badge.id"
            :x1="badge.screenX"
            :y1="badge.screenY"
            :x2="badge.screenX + (badge.offsetX || 0)"
            :y2="badge.screenY + (badge.offsetY || 0)"
            :stroke="isDark ? '#ffffff' : '#111827'"
            stroke-width="1.8"
            stroke-dasharray="3,3"
            style="display: none;"
            filter="url(#badge-glow)"
          />
          <circle
            :id="'badge-dot-' + badge.id"
            :cx="badge.screenX"
            :cy="badge.screenY"
            r="4"
            :fill="isDark ? '#ffffff' : '#111827'"
            :stroke="isDark ? '#000000' : '#ffffff'"
            stroke-width="1.5"
            style="display: none;"
          />
        </g>
      </svg>

      <!-- Draggable Measurement Badges -->
      <div
        v-for="badge in measurementBadges"
        :key="badge.id"
        :id="'badge-' + badge.id"
        v-show="badge.visible && badge.measureVisible !== false"
        :style="{
          position: 'absolute',
          left: (badge.screenX + (badge.offsetX || 0)) + 'px',
          top: (badge.screenY + (badge.offsetY || 0)) + 'px',
          transform: 'translate(-50%, -50%)',
          pointerEvents: (isBadgeInteractionBlocked && isDraggingBadge !== badge.id) ? 'none' : 'auto',
          cursor: isDraggingBadge === badge.id ? 'grabbing' : 'grab',
          zIndex: isDraggingBadge === badge.id ? 20 : 13
        }"
        @pointerdown="startDragBadge($event, badge)"
        @dblclick.stop="resetBadgeOffset(badge)"
        @wheel="handleBadgeWheel($event)"
        title="Drag to reposition badge and clear the view. Double-click to reset."
      >
        <v-chip
          :color="badge.isSaved ? 'info' : 'primary'"
          variant="elevated"
          elevation="6"
          size="small"
          class="font-weight-bold px-2 py-1 font-monospace"
          style="user-select: none; cursor: grab;"
        >
          <v-icon start size="small">mdi-arrow-expand-horizontal</v-icon>
          <span>{{ badge.text }}</span>
          <v-btn
            icon
            variant="text"
            size="x-small"
            class="ml-1"
            style="width: 18px; height: 18px; min-width: 18px; margin-right: -4px;"
            @click.stop="deleteMeasurement(badge.measureId || badge.id)"
            @pointerdown.stop
            title="Delete this dimension"
          >
            <v-icon size="12">mdi-close</v-icon>
          </v-btn>
        </v-chip>
      </div>
    </div>

    <!-- Floating Persistent Dimensions Indicator (visible when tool panel is closed but dimensions exist) -->
    <v-chip
      v-if="!measureActive && visibleMeasurementBadges && visibleMeasurementBadges.length > 0"
      color="primary"
      variant="elevated"
      elevation="4"
      size="small"
      class="persistent-dims-pill font-weight-medium"
      style="position: absolute; bottom: 84px; left: 24px; z-index: 10; backdrop-filter: blur(8px);"
    >
      <v-icon start size="small">mdi-ruler</v-icon>
      {{ visibleMeasurementBadges.length }} {{ visibleMeasurementBadges.length === 1 ? 'dimension on screen' : 'dimensions on screen' }}
      <v-btn
        variant="text"
        size="x-small"
        class="ml-1 font-weight-bold text-caption text-decoration-underline"
        @click.stop="clearAllMeasurements"
      >
        Clear
      </v-btn>
      <v-btn
        variant="text"
        size="x-small"
        class="ml-1 font-weight-bold text-caption text-decoration-underline"
        @click.stop="toggleMeasurement"
      >
        Measure more
      </v-btn>
    </v-chip>

    <!-- Floating Section Analysis Dialog/Panel -->
    <v-fade-transition>
      <v-card
        v-if="sectionPanelOpen"
        class="section-analysis-card"
        elevation="8"
        rounded="lg"
        :style="getSectionPanelStyle()"
        @pointerdown="bringToFront('section')"
      >
        <v-card-item
          class="pb-1 pt-2 px-3 panel-drag-header"
          @pointerdown="startDragPanel($event, 'section')"
          @dblclick="resetPanelPos('section')"
        >
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center drag-title-area text-truncate" style="min-width: 0; flex: 1;">
              <v-icon size="18" color="medium-emphasis" class="mr-1 flex-shrink-0 drag-handle-icon">
                mdi-drag-vertical
                <v-tooltip activator="parent" location="top">Drag to move panel • Double-click to reset</v-tooltip>
              </v-icon>
              <v-icon color="primary" class="mr-1 flex-shrink-0">mdi-vector-intersection</v-icon>
              <span v-if="!sectionPanelCollapsed" class="status-indicator-dot mr-2" title="Active tool"></span>
              <span class="text-subtitle-2 font-weight-bold text-truncate">{{ minimalistMode ? 'Section' : 'Section Analysis' }}</span>
              <v-chip v-if="sectionPanelCollapsed" size="x-small" color="primary" class="ml-2 font-weight-bold flex-shrink-0" variant="flat">
                {{ sectionAxis.toUpperCase() }}: {{ (sectionOffset || 0).toFixed(1) }} mm
              </v-chip>
            </div>
            <div class="panel-header-actions flex-shrink-0" @pointerdown.stop>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                :color="minimalistMode ? 'primary' : undefined"
                @click.stop="toggleMinimalistMode"
              >
                <v-icon size="16">{{ minimalistMode ? 'mdi-unfold-more-horizontal' : 'mdi-unfold-less-horizontal' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ minimalistMode ? 'Minimalist mode active (show advanced options)' : 'Activate minimalist mode (essential only)' }}
                </v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                @click.stop="togglePanelCollapse('section')"
              >
                <v-icon size="16">{{ sectionPanelCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ sectionPanelCollapsed ? 'Expand section panel' : 'Collapse section panel' }}
                </v-tooltip>
              </v-btn>
              <div class="panel-header-divider"></div>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                color="error"
                @click="deactivateSection"
              >
                <v-icon size="16">mdi-power</v-icon>
                <v-tooltip activator="parent" location="top">Deactivate and remove cut</v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                @click="closePanel"
              >
                <v-icon size="16">mdi-close</v-icon>
                <v-tooltip activator="parent" location="top">Hide panel (cut remains active)</v-tooltip>
              </v-btn>
            </div>
          </div>
        </v-card-item>

        <v-expand-transition>
          <div v-show="!sectionPanelCollapsed">
            <v-card-text class="pt-2 pb-3">
              <!-- MINIMALIST VIEW: axis toggle, slider and primary actions only -->
              <template v-if="minimalistMode">
                <v-btn-toggle
                  v-model="sectionAxis"
                  mandatory
                  density="compact"
                  color="primary"
                  class="w-100 mb-2"
                  @update:model-value="onAxisChange"
                >
                  <v-btn value="x" class="flex-grow-1" size="small">Plane X</v-btn>
                  <v-btn value="y" class="flex-grow-1" size="small">Plane Y</v-btn>
                  <v-btn value="z" class="flex-grow-1" size="small">Plane Z</v-btn>
                </v-btn-toggle>

                <div class="d-flex align-center justify-space-between mb-1">
                  <span class="text-caption font-weight-medium text-medium-emphasis">Offset</span>
                  <v-chip size="x-small" color="primary" variant="flat" class="font-weight-bold font-monospace">
                    {{ Number(sectionOffset).toFixed(1) }} mm
                  </v-chip>
                </div>
                <v-slider
                  v-model="sectionOffset"
                  :min="sectionMin"
                  :max="sectionMax"
                  :step="sectionStep"
                  density="compact"
                  color="primary"
                  hide-details
                  class="mb-2"
                  @update:model-value="onOffsetChange"
                />

                <div class="d-flex justify-space-between align-center">
                  <v-btn
                    size="x-small"
                    :variant="sectionInvert ? 'flat' : 'outlined'"
                    :color="sectionInvert ? 'primary' : undefined"
                    prepend-icon="mdi-swap-horizontal"
                    @click="toggleInvert"
                  >
                    Invert
                  </v-btn>
                  <v-btn
                    size="x-small"
                    variant="text"
                    prepend-icon="mdi-restart"
                    @click="resetToCenter"
                  >
                    Center
                  </v-btn>
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="primary"
                    prepend-icon="mdi-tune"
                    @click="toggleMinimalistMode"
                  >
                    + Settings
                  </v-btn>
                </div>
              </template>

              <!-- FULL VIEW: all advanced cutting controls -->
              <template v-else>
                <!-- Cutting plane axis -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">CUTTING PLANE</div>
          <v-btn-toggle
            v-model="sectionAxis"
            mandatory
            density="compact"
            color="primary"
            class="w-100 mb-3"
            @update:model-value="onAxisChange"
          >
            <v-btn value="x" class="flex-grow-1" size="small">Plane X</v-btn>
            <v-btn value="y" class="flex-grow-1" size="small">Plane Y</v-btn>
            <v-btn value="z" class="flex-grow-1" size="small">Plane Z</v-btn>
          </v-btn-toggle>

          <!-- Position slider -->
          <div class="d-flex justify-space-between align-center mb-1">
            <span class="text-caption font-weight-bold text-medium-emphasis">OFFSET</span>
            <v-chip size="x-small" color="primary" variant="flat">
              {{ Number(sectionOffset).toFixed(1) }} mm
            </v-chip>
          </div>
          <v-slider
            v-model="sectionOffset"
            :min="sectionMin"
            :max="sectionMax"
            :step="sectionStep"
            density="compact"
            color="primary"
            hide-details
            class="mb-3"
            @update:model-value="onOffsetChange"
          ></v-slider>

          <!-- Invert / Center actions -->
          <div class="d-flex justify-space-between align-center mb-2">
            <v-btn
              size="small"
              :variant="sectionInvert ? 'flat' : 'outlined'"
              :color="sectionInvert ? 'primary' : undefined"
              prepend-icon="mdi-swap-horizontal"
              @click="toggleInvert"
            >
              Invert cut
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-restart"
              @click="resetToCenter"
            >
              Center
            </v-btn>
          </div>

          <!-- Technical cross-section hatch -->
          <v-divider class="my-2"></v-divider>

          <v-checkbox
            v-model="sectionShowHatch"
            label="Cross-section hatch"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="applySection"
          ></v-checkbox>

          <v-fade-transition>
            <div v-if="sectionShowHatch" class="mb-2 pl-1 pr-1">
              <div class="d-flex justify-space-between align-center my-1">
                <span class="text-caption text-medium-emphasis">HATCH PATTERN</span>
                <v-btn-toggle
                  v-model="sectionHatchStyle"
                  mandatory
                  density="compact"
                  color="primary"
                  @update:model-value="applySection"
                >
                  <v-btn value="diagonal" size="x-small">45° ANSI</v-btn>
                  <v-btn value="cross" size="x-small">Cross</v-btn>
                  <v-btn value="solid" size="x-small">Solid</v-btn>
                </v-btn-toggle>
              </div>

              <!-- Color Palette: Pastel (default) or Vivid -->
              <div class="d-flex justify-space-between align-center my-1">
                <span class="text-caption text-medium-emphasis">TONALITY</span>
                <v-btn-toggle
                  v-model="sectionPaletteMode"
                  mandatory
                  density="compact"
                  color="primary"
                  @update:model-value="applySection"
                >
                  <v-btn value="pastel" size="x-small">Pastel</v-btn>
                  <v-btn value="vivid" size="x-small">Vivid</v-btn>
                </v-btn-toggle>
              </div>

              <!-- Hatch line spacing / scale slider -->
              <div v-if="sectionHatchStyle !== 'solid'" class="mt-2">
                <div class="d-flex justify-space-between align-center mb-1">
                  <span class="text-caption text-medium-emphasis">HATCH SCALE</span>
                  <span class="text-caption font-weight-bold">{{ Number(sectionHatchDensity).toFixed(1) }}x</span>
                </div>
                <v-slider
                  v-model="sectionHatchDensity"
                  :min="0.5"
                  :max="3.0"
                  :step="0.25"
                  density="compact"
                  color="primary"
                  hide-details
                  @update:model-value="applySection"
                ></v-slider>
              </div>
            </div>
          </v-fade-transition>

          <!-- 3D visual guide plane -->
          <v-checkbox
            v-model="sectionShowPlane"
            label="Show 3D guide plane"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="applySection"
          ></v-checkbox>

          <!-- On-screen 3D manipulator (Gizmo) -->
          <v-checkbox
            v-model="sectionShowGizmo"
            label="3D Gizmo (Cut manipulator)"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="applySection"
          ></v-checkbox>

          <div class="text-right mt-2">
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="primary"
                    density="compact"
                    prepend-icon="mdi-unfold-less-horizontal"
                    @click="toggleMinimalistMode"
                  >
                    Minimalist mode
                  </v-btn>
                </div>
              </template>
            </v-card-text>
      </div>
    </v-expand-transition>
  </v-card>
</v-fade-transition>

    <!-- Floating CAD Measurement Dialog/Panel -->
    <v-fade-transition>
      <v-card
        v-if="measurePanelOpen"
        class="measurement-panel-card"
        elevation="8"
        rounded="lg"
        :style="getMeasurePanelStyle()"
        @pointerdown="bringToFront('measure')"
      >
        <v-card-item
          class="pb-1 pt-2 px-3 panel-drag-header"
          @pointerdown="startDragPanel($event, 'measure')"
          @dblclick="resetPanelPos('measure')"
        >
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center drag-title-area text-truncate" style="min-width: 0; flex: 1;">
              <v-icon size="18" color="medium-emphasis" class="mr-1 flex-shrink-0 drag-handle-icon">
                mdi-drag-vertical
                <v-tooltip activator="parent" location="top">Drag to move panel • Double-click to reset</v-tooltip>
              </v-icon>
              <v-icon color="primary" class="mr-1 flex-shrink-0">mdi-ruler-square</v-icon>
              <span v-if="!measurePanelCollapsed" class="status-indicator-dot mr-2" title="Active tool"></span>
              <span class="text-subtitle-2 font-weight-bold text-truncate">{{ minimalistMode ? 'Measure' : 'CAD Measurement' }}</span>
              <v-chip v-if="measurePanelCollapsed && currentMeasurement" size="x-small" color="primary" class="ml-2 font-weight-bold flex-shrink-0" variant="flat">
                {{ currentMeasurement.primaryValue }}
              </v-chip>
            </div>
            <div class="panel-header-actions flex-shrink-0" @pointerdown.stop>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                :color="minimalistMode ? 'primary' : undefined"
                @click.stop="toggleMinimalistMode"
              >
                <v-icon size="16">{{ minimalistMode ? 'mdi-unfold-more-horizontal' : 'mdi-unfold-less-horizontal' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ minimalistMode ? 'Minimalist mode active (show full options)' : 'Activate minimalist mode (essential only)' }}
                </v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                @click.stop="togglePanelCollapse('measure')"
              >
                <v-icon size="16">{{ measurePanelCollapsed ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ measurePanelCollapsed ? 'Expand measurement panel' : 'Collapse measurement panel' }}
                </v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                :color="measureXray ? 'warning' : undefined"
                @click="toggleMeasureXray"
              >
                <v-icon size="16">{{ measureXray ? 'mdi-eye-outline' : 'mdi-eye-off-outline' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ measureXray ? 'X-Ray: Active (visible through parts)' : '3D Occlusion: Active (hidden behind solid geometry)' }}
                </v-tooltip>
              </v-btn>
              <v-btn
                v-if="currentMeasurement && !minimalistMode"
                icon
                variant="text"
                class="panel-action-btn"
                :color="copiedTarget === 'all' ? 'success' : undefined"
                @click="copyAllMeasurement"
              >
                <v-icon size="16">{{ copiedTarget === 'all' ? 'mdi-check' : 'mdi-clipboard-text-outline' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ copiedTarget === 'all' ? 'Report copied!' : 'Copy full report' }}
                </v-tooltip>
              </v-btn>
              <div class="panel-header-divider"></div>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                color="error"
                @click="deactivateMeasurement"
              >
                <v-icon size="16">mdi-power</v-icon>
                <v-tooltip activator="parent" location="top">Close and deactivate measurement</v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                class="panel-action-btn"
                @click="measurePanelOpen = false"
              >
                <v-icon size="16">mdi-close</v-icon>
                <v-tooltip activator="parent" location="top">Hide panel (dimensions remain visible)</v-tooltip>
              </v-btn>
            </div>
          </div>
        </v-card-item>

        <v-expand-transition>
          <div v-show="!measurePanelCollapsed">
            <v-card-text class="pt-2 pb-3">
              <!-- MINIMALIST VIEW: mode, primary value and essential action only -->
              <template v-if="minimalistMode">
                <v-btn-toggle
                  v-model="measureMode"
                  mandatory
                  density="compact"
                  color="primary"
                  class="w-100 mb-2"
                  @update:model-value="onMeasureModeChange"
                >
                  <v-btn value="smart" class="flex-grow-1 px-1" size="x-small">Auto</v-btn>
                  <v-btn value="planes" class="flex-grow-1 px-1" size="x-small">Planes</v-btn>
                  <v-btn value="lines" class="flex-grow-1 px-1" size="x-small">Lines</v-btn>
                  <v-btn value="radius" class="flex-grow-1 px-1" size="x-small">Radius</v-btn>
                  <v-btn value="distance" class="flex-grow-1 px-1" size="x-small">3D</v-btn>
                </v-btn-toggle>

                <!-- Minimalist prompt when no measurement is active -->
                <div
                  v-if="!currentMeasurement"
                  class="pa-2 rounded d-flex align-center justify-space-between mb-2"
                  style="background-color: rgba(var(--v-theme-surface-soft), 0.85); border: 1px solid rgba(var(--v-theme-on-surface), 0.1);"
                >
                  <div class="d-flex align-center text-truncate mr-1">
                    <v-icon size="16" color="primary" class="mr-1 flex-shrink-0">mdi-cursor-default-click</v-icon>
                    <span class="text-caption font-weight-medium text-truncate" :title="measurePrompt || getSelectionPrompt()">
                      {{ firstSelectionSnap ? 'P1 locked • Click P2' : (measurePrompt || getSelectionPrompt()) }}
                    </span>
                  </div>
                  <v-chip v-if="firstSelectionSnap" size="x-small" color="primary" variant="flat" class="font-weight-bold">1/2</v-chip>
                  <v-chip v-else-if="measureMode === 'radius' && radiusPointsCount > 0" size="x-small" color="primary" variant="flat" class="font-weight-bold">{{ radiusPointsCount }}/3</v-chip>
                </div>

                <!-- Minimalist result when measurement is active -->
                <div
                  v-else
                  class="pa-2 rounded mb-2"
                  style="background-color: rgba(var(--v-theme-primary), 0.08); border: 1px solid rgba(var(--v-theme-primary), 0.25);"
                >
                  <div class="d-flex justify-space-between align-center mb-1">
                    <span class="text-caption font-weight-bold text-medium-emphasis text-uppercase text-truncate" style="font-size: 11px !important;">
                      {{ currentMeasurement.title }}
                    </span>
                    <span v-if="currentMeasurement.secondaryValue" class="text-caption text-medium-emphasis font-monospace" style="font-size: 11px !important;">
                      {{ currentMeasurement.secondaryValue }}
                    </span>
                  </div>
                  <div class="d-flex justify-space-between align-center">
                    <div class="text-h6 font-weight-bold" style="color: rgb(var(--v-theme-primary)); line-height: 1.1;">
                      {{ currentMeasurement.primaryValue }}
                    </div>
                    <div class="d-flex align-center">
                      <v-btn
                        icon
                        variant="tonal"
                        size="x-small"
                        color="primary"
                        class="mr-1"
                        @click="copyMeasurementValue(currentMeasurement.primaryValue, 'primary')"
                      >
                        <v-icon size="14">{{ copiedTarget === 'primary' ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                        <v-tooltip activator="parent" location="top">Copy value</v-tooltip>
                      </v-btn>
                      <v-btn
                        icon
                        variant="text"
                        size="x-small"
                        color="error"
                        @click="clearAllMeasurements"
                      >
                        <v-icon size="14">mdi-trash-can-outline</v-icon>
                        <v-tooltip activator="parent" location="top">Delete</v-tooltip>
                      </v-btn>
                    </div>
                  </div>
                </div>

                <div class="d-flex justify-space-between align-center">
                  <v-btn
                    size="x-small"
                    variant="flat"
                    color="primary"
                    prepend-icon="mdi-plus"
                    class="text-none font-weight-medium px-2"
                    @click="commitAndNewMeasurement"
                  >
                    Pin / New
                  </v-btn>
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="primary"
                    prepend-icon="mdi-tune"
                    class="text-none font-weight-medium px-2"
                    @click="toggleMinimalistMode"
                  >
                    + Breakdown
                  </v-btn>
                </div>
              </template>

              <!-- FULL VIEW: breakdown, measurement list and persistence -->
              <template v-else>
                <!-- Measurement mode -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">MEASUREMENT TYPE</div>
          <v-btn-toggle
            v-model="measureMode"
            mandatory
            density="compact"
            color="primary"
            class="w-100 mb-3"
            @update:model-value="onMeasureModeChange"
          >
            <v-btn value="smart" class="flex-grow-1" size="small">Auto</v-btn>
            <v-btn value="planes" class="flex-grow-1" size="small">Planes</v-btn>
            <v-btn value="lines" class="flex-grow-1" size="small">Lines</v-btn>
            <v-btn value="radius" class="flex-grow-1" size="small">Radius / Ø</v-btn>
            <v-btn value="distance" class="flex-grow-1" size="small">3D</v-btn>
          </v-btn-toggle>

          <!-- Interaction prompt / Selection status -->
          <div
            v-if="!currentMeasurement"
            class="pa-3 rounded mb-3"
            style="background-color: rgba(var(--v-theme-surface-soft), 0.85); border: 1px solid rgba(var(--v-theme-on-surface), 0.1); color: rgb(var(--v-theme-on-surface));"
          >
            <div v-if="firstSelectionSnap" class="d-flex align-center mb-1">
              <v-chip size="x-small" color="primary" class="mr-2 font-weight-bold" variant="flat">
                Step 1 Locked
              </v-chip>
              <span class="text-caption font-weight-medium" style="color: rgb(var(--v-theme-on-surface));">
                {{ firstSelectionSnap.type === 'face' ? 'Planar face' : (firstSelectionSnap.type === 'vertex' ? 'Point / Vertex' : (firstSelectionSnap.type === 'edge' ? 'Line / Edge' : (firstSelectionSnap.type === 'cylinder' ? 'Cylinder / Circle' : 'Point'))) }}
              </span>
            </div>
            <div v-if="measureMode === 'radius' && radiusPointsCount > 0" class="d-flex align-center mb-1">
              <v-chip size="x-small" color="primary" class="mr-2 font-weight-bold" variant="flat">
                {{ radiusPointsCount }}/3 Points
              </v-chip>
            </div>
            <div class="d-flex align-center">
              <v-icon size="small" color="primary" class="mr-1">mdi-cursor-default-click</v-icon>
              <span class="text-caption font-weight-medium" style="color: rgb(var(--v-theme-on-surface));">
                {{ measurePrompt || getSelectionPrompt() }}
              </span>
            </div>
            <div class="text-caption text-medium-emphasis mt-2 pt-1 border-t d-flex align-center" style="font-size: 11px !important;">
              <v-icon size="x-small" class="mr-1">mdi-mouse</v-icon>
              <span>Left click: select | Right click: rotate view</span>
            </div>
          </div>

          <!-- Current measurement result with copy buttons -->
          <div
            v-else
            class="pa-3 rounded mb-3"
            style="background-color: rgba(var(--v-theme-surface-soft), 0.85); border: 1px solid rgba(var(--v-theme-primary), 0.35); color: rgb(var(--v-theme-on-surface));"
          >
            <div class="d-flex justify-space-between align-center mb-1">
              <span class="text-caption font-weight-bold text-medium-emphasis text-uppercase">
                {{ currentMeasurement.title }}
              </span>
              <v-chip size="x-small" color="primary" variant="flat">
                {{ currentMeasurement.unit }}
              </v-chip>
            </div>

            <!-- Primary value with copy button -->
            <div class="d-flex justify-space-between align-center my-1 pa-2 rounded" style="background-color: rgba(var(--v-theme-primary), 0.08); border: 1px solid rgba(var(--v-theme-primary), 0.15);">
              <div class="text-h5 font-weight-bold" style="color: rgb(var(--v-theme-primary)); line-height: 1.2;">
                {{ currentMeasurement.primaryValue }}
              </div>
              <v-btn
                icon
                variant="tonal"
                size="small"
                color="primary"
                @click="copyMeasurementValue(currentMeasurement.primaryValue, 'primary')"
              >
                <v-icon size="16">{{ copiedTarget === 'primary' ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ copiedTarget === 'primary' ? 'Value copied!' : 'Copy primary value' }}
                </v-tooltip>
              </v-btn>
            </div>

            <div v-if="currentMeasurement.secondaryValue" class="text-caption text-medium-emphasis mb-2 px-1">
              {{ currentMeasurement.secondaryValue }}
            </div>

            <v-divider class="my-2"></v-divider>

            <!-- Detailed breakdown (deltas, centers, etc) with per-row copy -->
            <div
              v-for="(detail, idx) in currentMeasurement.details"
              :key="detail.label"
              class="d-flex justify-space-between align-center text-caption py-1 px-1 measurement-detail-row"
              style="border-radius: 4px; transition: background-color 0.15s ease;"
            >
              <span class="text-medium-emphasis mr-2">{{ detail.label }}:</span>
              <div class="d-flex align-center">
                <span class="font-weight-medium font-monospace mr-1" style="color: rgb(var(--v-theme-on-surface));">{{ detail.value }}</span>
                <v-btn
                  icon
                  variant="text"
                  size="x-small"
                  density="compact"
                  :color="copiedTarget === 'detail-' + idx ? 'success' : undefined"
                  @click="copyMeasurementValue(detail.value, 'detail-' + idx)"
                >
                  <v-icon size="13">{{ copiedTarget === 'detail-' + idx ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
                  <v-tooltip activator="parent" location="top">
                    {{ copiedTarget === 'detail-' + idx ? 'Copied!' : 'Copy ' + detail.label }}
                  </v-tooltip>
                </v-btn>
              </div>
            </div>
          </div>

          <!-- Actions: New Measurement / Copy / Clear -->
          <div class="d-flex align-center ga-2 mt-2">
            <v-btn
              size="small"
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              class="flex-grow-1 text-none font-weight-bold"
              @click="commitAndNewMeasurement"
            >
              Pin & Measure New
            </v-btn>
            <v-btn
              v-if="currentMeasurement"
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-content-copy"
              class="text-none font-weight-medium"
              @click="copyAllMeasurement"
            >
              {{ copiedTarget === 'all' ? 'Copied!' : 'Copy' }}
              <v-tooltip activator="parent" location="top">Copy full report</v-tooltip>
            </v-btn>
            <v-btn
              size="small"
              variant="outlined"
              color="error"
              prepend-icon="mdi-trash-can-outline"
              class="text-none font-weight-medium"
              @click="clearAllMeasurements"
            >
              Delete
              <v-tooltip activator="parent" location="top">Delete all dimensions on screen</v-tooltip>
            </v-btn>
          </div>

          <!-- Dimension persistence options -->
          <div class="mt-3 pt-2" style="border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);">
            <div class="d-flex align-center justify-space-between">
              <span class="text-caption font-weight-medium">Keep dimensions when closing panel</span>
              <v-switch
                v-model="keepMeasurementsOnExit"
                density="compact"
                color="primary"
                hide-details
                @update:model-value="toggleKeepMeasurements"
              />
            </div>
          </div>

          <!-- List of pinned dimensions on screen -->
          <div v-if="savedMeasurements && savedMeasurements.length > 0" class="mt-2">
            <div class="d-flex justify-space-between align-center mb-1">
              <span class="text-caption font-weight-bold text-medium-emphasis">
                SCREEN DIMENSIONS ({{ savedMeasurements.length }})
              </span>
              <v-btn
                variant="text"
                size="x-small"
                color="error"
                class="px-1 text-caption"
                @click="clearAllMeasurements"
              >
                Clear all
              </v-btn>
            </div>
            <v-list density="compact" class="pa-0 bg-transparent" style="max-height: 120px; overflow-y: auto;">
              <v-list-item
                v-for="(sm, idx) in savedMeasurements"
                :key="sm.id"
                class="px-2 py-1 mb-1 rounded"
                style="background: rgba(var(--v-theme-surface-soft), 0.7); border: 1px solid rgba(var(--v-theme-on-surface), 0.08);"
              >
                <template #prepend>
                  <v-chip size="x-small" color="info" class="mr-2 font-weight-bold" variant="flat">
                    #{{ idx + 1 }}
                  </v-chip>
                </template>
                <v-list-item-title class="text-caption font-weight-bold">
                  {{ sm.title }}
                </v-list-item-title>
                <v-list-item-subtitle class="text-caption font-monospace font-weight-bold text-primary">
                  {{ sm.primaryValue }}
                </v-list-item-subtitle>
                <template #append>
                  <v-btn
                    icon
                    size="x-small"
                    variant="text"
                    color="error"
                    @click.stop="deleteMeasurement(sm.id)"
                    title="Delete this dimension"
                  >
                    <v-icon size="14">mdi-close</v-icon>
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </div>

          <div class="text-right mt-2">
            <v-btn
              size="x-small"
              variant="text"
              color="primary"
              density="compact"
              prepend-icon="mdi-unfold-less-horizontal"
              @click="toggleMinimalistMode"
            >
              Minimalist mode
            </v-btn>
          </div>
        </template>
      </v-card-text>
      </div>
    </v-expand-transition>
  </v-card>
</v-fade-transition>

    <!-- CAD Context Menu (Right Click Fusion 360 Style) -->
    <v-menu
      v-model="contextMenu.show"
      :target="[contextMenu.x, contextMenu.y]"
      location="end bottom"
      transition="scale-transition"
      :close-on-content-click="false"
      min-width="260"
      max-width="320"
    >
      <v-card
        elevation="12"
        rounded="lg"
        class="fusion-context-menu"
        style="backdrop-filter: blur(14px); background-color: rgba(var(--v-theme-surface), 0.96); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.12); box-shadow: 0 10px 36px rgba(0,0,0,0.35);"
      >
        <!-- If clicked on a CAD part -->
        <template v-if="contextMenu.modelObject">
          <!-- Part Header -->
          <div class="px-3 pt-3 pb-2 d-flex align-center">
            <v-avatar size="28" :color="contextMenu.colorHex || 'primary'" class="mr-2 text-white font-weight-bold" variant="flat">
              <v-icon size="16" color="white">mdi-cube-outline</v-icon>
            </v-avatar>
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
              <div class="text-subtitle-2 font-weight-bold text-truncate" :title="contextMenu.targetName">{{ contextMenu.targetName }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ contextMenu.targetType }}</div>
            </div>
            <v-btn icon="mdi-close" variant="text" size="x-small" @click="contextMenu.show = false" />
          </div>

          <v-divider />

          <v-list density="compact" class="py-1 bg-transparent">
            <!-- Isolate / Exit isolate -->
            <v-list-item
              :prepend-icon="contextMenu.isIsolated ? 'mdi-eye-off-outline' : 'mdi-select-compare'"
              :title="contextMenu.isIsolated ? 'Exit isolate' : 'Isolate part'"
              @click="contextMenu.isIsolated ? restoreIsolation() : isolatePart(contextMenu.modelObject)"
            />

            <!-- Hide / Show -->
            <v-list-item
              :prepend-icon="contextMenu.isVisible ? 'mdi-eye-off' : 'mdi-eye'"
              :title="contextMenu.isVisible ? 'Hide part' : 'Show part'"
              @click="togglePartVisibility(contextMenu.modelObject)"
            >
              <template v-slot:append>
                <kbd class="text-caption text-medium-emphasis ml-2 px-1 rounded border font-monospace" style="font-size: 11px;">Space</kbd>
              </template>
            </v-list-item>

            <!-- Focus part in view -->
            <v-list-item
              prepend-icon="mdi-crosshairs-gps"
              title="Focus in view"
              @click="zoomToPart(contextMenu.modelObject)"
            />
          </v-list>

          <v-divider />

          <!-- Quick Opacity / Transparency -->
          <div class="px-3 py-2">
            <div class="text-caption text-medium-emphasis mb-1 d-flex align-center justify-space-between">
              <span class="d-flex align-center">
                <v-icon size="small" class="mr-1">mdi-opacity</v-icon> Opacity
              </span>
              <span class="font-weight-bold font-monospace text-primary">{{ Math.round(contextMenu.currentOpacity * 100) }}%</span>
            </div>
            <v-btn-toggle
              :model-value="contextMenu.currentOpacity"
              mandatory
              density="compact"
              color="primary"
              class="w-100"
              @update:model-value="val => setPartOpacity(contextMenu.modelObject, val)"
            >
              <v-btn :value="1.0" size="x-small" class="flex-grow-1 font-weight-medium">100%</v-btn>
              <v-btn :value="0.75" size="x-small" class="flex-grow-1 font-weight-medium">75%</v-btn>
              <v-btn :value="0.5" size="x-small" class="flex-grow-1 font-weight-medium">50%</v-btn>
              <v-btn :value="0.25" size="x-small" class="flex-grow-1 font-weight-medium">25%</v-btn>
            </v-btn-toggle>
          </div>

          <v-divider />

          <v-list density="compact" class="py-1 bg-transparent">
            <!-- Properties and Info -->
            <v-list-item
              prepend-icon="mdi-information-outline"
              title="CAD Properties"
              @click="openPartInfo(contextMenu.modelObject)"
            />

            <!-- Copy Name -->
            <v-list-item
              prepend-icon="mdi-content-copy"
              title="Copy name"
              @click="copyPartName(contextMenu.modelObject)"
            />
          </v-list>
        </template>

        <!-- If clicked in empty space (Canvas background) -->
        <template v-else>
          <div class="px-3 pt-3 pb-2 d-flex align-center justify-space-between">
            <div class="d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-axis-arrow</v-icon>
              <span class="text-subtitle-2 font-weight-bold">3D Workspace</span>
            </div>
            <v-btn icon="mdi-close" variant="text" size="x-small" @click="contextMenu.show = false" />
          </div>

          <v-divider />

          <v-list density="compact" class="py-1 bg-transparent">
            <v-list-item
              prepend-icon="mdi-eye"
              title="Show all parts"
              @click="showAllParts"
            />

            <v-list-item
              prepend-icon="mdi-opacity"
              title="Reset opacities (100%)"
              @click="resetAllOpacities"
            />

            <v-list-item
              v-if="contextMenu.hasIsolatedActive"
              prepend-icon="mdi-eye-check-outline"
              title="Exit isolation"
              @click="restoreIsolation"
            />

            <v-list-item
              prepend-icon="mdi-fit-to-screen-outline"
              title="Fit entire model"
              @click="fitModelToScreen"
            />

            <v-list-item
              prepend-icon="mdi-select-off"
              title="Deselect all"
              @click="clearSelection"
            />
          </v-list>
        </template>
      </v-card>
    </v-menu>

    <!-- Part Properties Dialog (Fusion 360 style info panel) -->
    <v-dialog
      v-model="partPropertiesDialog"
      max-width="520"
      transition="dialog-bottom-transition"
    >
      <v-card
        v-if="selectedPartProps"
        rounded="lg"
        elevation="16"
        style="background-color: rgba(var(--v-theme-surface), 0.98); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.12);"
      >
        <v-card-item class="pb-2 pt-4">
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center">
              <v-avatar size="32" :color="selectedPartProps.colorHex || 'primary'" class="mr-2 text-white">
                <v-icon size="18" color="white">mdi-cube-scan</v-icon>
              </v-avatar>
              <div>
                <div class="text-subtitle-1 font-weight-bold">{{ selectedPartProps.name }}</div>
                <div class="text-caption text-medium-emphasis">{{ selectedPartProps.type }}</div>
              </div>
            </div>
            <v-btn icon="mdi-close" variant="text" size="small" @click="partPropertiesDialog = false" />
          </div>
        </v-card-item>

        <v-divider />

        <v-card-text class="pt-3 pb-2" style="max-height: 480px; overflow-y: auto;">
          <!-- Bounding Box Dimensions -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2">DIMENSIONS (BOUNDING BOX)</div>
          <v-row dense class="mb-3">
            <v-col cols="4">
              <v-card variant="tonal" class="pa-2 text-center" rounded="md">
                <div class="text-caption text-medium-emphasis">Length X</div>
                <div class="text-body-2 font-weight-bold font-monospace text-primary">{{ selectedPartProps.sizeX.toFixed(2) }} mm</div>
              </v-card>
            </v-col>
            <v-col cols="4">
              <v-card variant="tonal" class="pa-2 text-center" rounded="md">
                <div class="text-caption text-medium-emphasis">Width Y</div>
                <div class="text-body-2 font-weight-bold font-monospace text-primary">{{ selectedPartProps.sizeY.toFixed(2) }} mm</div>
              </v-card>
            </v-col>
            <v-col cols="4">
              <v-card variant="tonal" class="pa-2 text-center" rounded="md">
                <div class="text-caption text-medium-emphasis">Height Z</div>
                <div class="text-body-2 font-weight-bold font-monospace text-primary">{{ selectedPartProps.sizeZ.toFixed(2) }} mm</div>
              </v-card>
            </v-col>
          </v-row>

          <!-- Geometric Center -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">GEOMETRIC CENTER (X, Y, Z)</div>
          <v-sheet rounded="md" class="pa-2 mb-3 font-monospace text-caption" style="background-color: rgba(var(--v-theme-on-surface), 0.04); border: 1px solid rgba(var(--v-theme-on-surface), 0.08);">
            [{{ selectedPartProps.centerX.toFixed(2)}}, {{ selectedPartProps.centerY.toFixed(2)}}, {{ selectedPartProps.centerZ.toFixed(2)}}] mm
          </v-sheet>

          <!-- CAD Mesh Topology -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">CAD MESH DETAILS</div>
          <v-table density="compact" class="mb-3 text-body-2" style="background: transparent;">
            <tbody>
              <tr>
                <td class="text-medium-emphasis">Triangles / Faces</td>
                <td class="text-right font-weight-bold font-monospace">{{ selectedPartProps.triangleCount.toLocaleString() }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Vertices</td>
                <td class="text-right font-weight-bold font-monospace">{{ selectedPartProps.vertexCount.toLocaleString() }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Submeshes</td>
                <td class="text-right font-weight-bold font-monospace">{{ selectedPartProps.meshCount }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Bounding Box Volume</td>
                <td class="text-right font-weight-bold font-monospace">{{ ((selectedPartProps.sizeX * selectedPartProps.sizeY * selectedPartProps.sizeZ) / 1000).toFixed(2) }} cm³</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Visibility</td>
                <td class="text-right font-weight-bold font-monospace">
                  <v-chip size="x-small" :color="selectedPartProps.visible ? 'success' : 'warning'" variant="tonal">
                    {{ selectedPartProps.visible ? 'Visible' : 'Hidden' }}
                  </v-chip>
                </td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Current Opacity</td>
                <td class="text-right font-weight-bold font-monospace">{{ Math.round(selectedPartProps.opacity * 100) }}%</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Base Color</td>
                <td class="text-right d-flex align-center justify-end font-monospace">
                  <span :style="{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: selectedPartProps.colorHex, borderRadius: '3px', marginRight: '6px', border: '1px solid rgba(0,0,0,0.2)' }"></span>
                  {{ selectedPartProps.colorHex }}
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- FreeCAD Parametric Properties (if any) -->
          <div v-if="selectedPartProps.fcProperties && selectedPartProps.fcProperties.length > 0">
            <div class="text-caption font-weight-bold text-medium-emphasis mb-1">FREECAD PROPERTIES</div>
            <v-table density="compact" class="text-body-2 mb-2" style="background: transparent;">
              <tbody>
                <tr v-for="prop in selectedPartProps.fcProperties" :key="prop.name">
                  <td class="text-medium-emphasis font-weight-medium">{{ prop.name }}</td>
                  <td class="text-right font-monospace text-truncate" style="max-width: 220px;" :title="prop.value">{{ prop.value }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </v-card-text>

        <v-divider />

        <v-card-actions class="px-4 py-2 justify-space-between">
          <v-btn
            prepend-icon="mdi-content-copy"
            variant="text"
            color="primary"
            size="small"
            @click="copyAllProperties(selectedPartProps)"
          >
            Copy information
          </v-btn>
          <v-btn
            variant="tonal"
            size="small"
            @click="partPropertiesDialog = false"
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Copy Notification Toast -->
    <v-snackbar
      v-model="snackbar"
      :timeout="2200"
      location="top right"
      color="surface"
      elevation="8"
      rounded="pill"
      style="z-index: 100;"
    >
      <div class="d-flex align-center py-1 px-2">
        <v-icon color="success" class="mr-2">mdi-check-circle</v-icon>
        <span class="text-body-2 font-weight-medium" style="color: rgb(var(--v-theme-on-surface));">{{ snackbarText }}</span>
      </div>
    </v-snackbar>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import { Viewer } from '@/threejs/viewer';

export default {
  name: 'ModelViewer',
  props: {
    // objUrl: String,
    fullScreen: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['model:loaded', 'object:clicked', 'section:changed', 'measure:changed'],
  data: () => ({
    obj: null,
    objUrl: '',
    isLoaded: false,
    sectionActive: false,
    sectionPanelOpen: false,
    sectionAxis: 'z',
    sectionOffset: 0,
    sectionInvert: false,
    sectionShowPlane: true,
    sectionShowGizmo: true,
    sectionShowHatch: true,
    sectionHatchStyle: 'diagonal',
    sectionHatchDensity: 1.0,
    sectionPaletteMode: 'pastel',
    sectionMin: -100,
    sectionMax: 100,
    sectionStep: 0.5,
    measureActive: false,
    measurePanelOpen: false,
    measureMode: 'smart',
    measureXray: false,
    currentMeasurement: null,
    measurementBadges: [],
    savedMeasurements: [],
    keepMeasurementsOnExit: true,
    isDraggingBadge: null,
    firstSelectionSnap: null,
    measurePrompt: '',
    radiusPointsCount: 0,
    copiedTarget: null,
    snackbar: false,
    snackbarText: '',
    contextMenu: {
      show: false,
      x: 0,
      y: 0,
      modelObject: null,
      targetName: '',
      targetType: '',
      colorHex: '#00e5ff',
      isVisible: true,
      isIsolated: false,
      currentOpacity: 1.0,
      hasIsolatedActive: false,
    },
    partPropertiesDialog: false,
    selectedPartProps: null,
    navigationStyle: (typeof localStorage !== 'undefined' && localStorage.getItem('ondsel_nav_style')) || 'touchpad',
    navMenuOpen: false,
    measurePanelPos: { x: null, y: null },
    sectionPanelPos: { x: null, y: null },
    measurePanelCollapsed: false,
    sectionPanelCollapsed: false,
    isDraggingPanel: null,
    panelZIndices: { measure: 15, section: 15 },
    highestPanelZIndex: 15,
    minimalistMode: (typeof localStorage !== 'undefined' && localStorage.getItem('ondsel_minimalist_mode') === 'true') || false,
    isViewerNavigating: false,
    isNavModifierActive: false,
  }),
  computed: {
    viewport3d: vm => vm.$refs.modelViewer,
    viewerWidth: (vm) => vm.fullScreen ? window.innerWidth : window.innerWidth - 64,
    viewerHeight: (vm) => vm.fullScreen ? window.innerHeight : window.innerHeight - 64,
    isBadgeInteractionBlocked() {
      return this.isViewerNavigating || this.isNavModifierActive;
    },
    isDark() {
      return this.$vuetify?.theme?.global?.name === 'dark' || !!(this.$vuetify?.theme?.current?.dark);
    },
    navStyleTitle() {
      switch (this.navigationStyle) {
        case 'touchpad': return 'Touchpad (FreeCAD)';
        case 'cad': return 'CAD (FreeCAD)';
        case 'blender': return 'Blender';
        default: return 'Standard / Orbit';
      }
    },
    visibleMeasurementBadges() {
      if (!this.measurementBadges) return [];
      return this.measurementBadges.filter(b => b.visible && b.measureVisible !== false);
    },
  },
  watch: {
    isDark: {
      immediate: true,
      handler(val) {
        if (this.viewer && typeof this.viewer.setDarkTheme === 'function') {
          this.viewer.setDarkTheme(val);
        }
      }
    }
  },
  mounted() {
    if (typeof window !== 'undefined') {
      window.__model_viewer_vm = this;
    }
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    this.loadSavedPanelPositions();
    window.addEventListener('resize', this.clampPanelPositions);
  },
  beforeUnmount() {
    if (typeof window !== 'undefined' && window.__model_viewer_vm === this) {
      window.__model_viewer_vm = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('resize', this.clampPanelPositions);
    if (this.viewer && typeof this.viewer.destroy === 'function') {
      this.viewer.destroy();
    }
  },
  created() {
  },
  methods: {
    handleKeyUp(e) {
      if (e.key === 'Alt' || e.key === 'Shift') {
        this.isNavModifierActive = (e.altKey || e.shiftKey);
      }
    },
    handleBlur() {
      this.isNavModifierActive = false;
      this.isViewerNavigating = false;
    },
    handleKeyDown(e) {
      if (e.key === 'Alt' || e.key === 'Shift') {
        this.isNavModifierActive = true;
      }
      if (e.key === 'Escape') {
        const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
          return;
        }

        // 1. Close context menu if open
        if (this.contextMenu && this.contextMenu.show) {
          this.contextMenu.show = false;
          e.preventDefault();
          return;
        }

        // 2. Close part properties dialog if open
        if (this.partPropertiesDialog) {
          this.partPropertiesDialog = false;
          e.preventDefault();
          return;
        }

        // 3. Exit measurement tool if active or panel open
        if (this.measureActive || this.measurePanelOpen) {
          this.deactivateMeasurement();
          e.preventDefault();
          return;
        }

        // 4. Deselect objects if any are selected in the 3D viewport
        if (this.viewer && this.viewer.selectedObjs && this.viewer.selectedObjs.length > 0) {
          this.clearSelection();
          e.preventDefault();
          return;
        }
      }

      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
        const isTextInput = (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(e.target.type)) ||
                            tag === 'textarea' ||
                            tag === 'select' ||
                            (e.target && e.target.isContentEditable) ||
                            (e.target && e.target.closest && e.target.closest('.cm-editor'));
        if (isTextInput) {
          return;
        }

        // Do not intercept Space if a modal dialog is open
        if (this.partPropertiesDialog || (typeof document !== 'undefined' && document.querySelector('.v-overlay--active .v-dialog'))) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        // 1. If context menu is open on a piece, toggle that piece
        if (this.contextMenu && this.contextMenu.show && this.contextMenu.modelObject) {
          const target = this.contextMenu.modelObject;
          this.togglePartVisibility(target);
          this.contextMenu.show = false;
          return;
        }

        // 2. If one or more pieces are selected in the viewport or tree
        if (this.viewer && this.viewer.selectedObjs && this.viewer.selectedObjs.length > 0) {
          const res = this.viewer.toggleSelectedVisibility();
          if (res) {
            if (res.count === 1) {
              const name = res.firstObj.name || (res.firstObj.GetLabel ? res.firstObj.GetLabel() : 'CAD');
              this.showSnackbar(res.targetVis ? `Part visible: ${name}` : `Part hidden: ${name}`);
            } else {
              const visibleCount = res.objs.filter(o => (o.GetVisibility ? o.GetVisibility() : true)).length;
              const hiddenCount = res.count - visibleCount;
              if (hiddenCount === 0) {
                this.showSnackbar(`${res.count} visible parts`);
              } else if (visibleCount === 0) {
                this.showSnackbar(`${res.count} hidden parts`);
              } else {
                this.showSnackbar(`Toggled visibility (${visibleCount} visible, ${hiddenCount} hidden)`);
              }
            }
          }
          return;
        }

        // 3. If hovering over a piece in the 3D viewport, select and toggle it
        if (this.viewer && this.viewer.isPointerOver && typeof this.viewer.raycastMesh === 'function' && this.viewer.pointer) {
          const hitMesh = this.viewer.raycastMesh(this.viewer.pointer);
          if (hitMesh && typeof this.viewer.findModelObjectForThreeObject === 'function') {
            const modelObj = this.viewer.findModelObjectForThreeObject(hitMesh);
            if (modelObj) {
              this.viewer.selectGivenObject(modelObj, true);
              this.viewer.toggleObjectVisibility(modelObj);
              const isVis = modelObj.GetVisibility ? modelObj.GetVisibility() : true;
              const name = modelObj.name || (modelObj.GetLabel ? modelObj.GetLabel() : 'CAD');
              this.showSnackbar(isVis ? `Part visible: ${name}` : `Part hidden: ${name}`);
              return;
            }
          }
        }
      }
    },

    init(objUrl) {
      this.objUrl = objUrl;
      this.viewer = new Viewer(
        this.objUrl,
        this.viewerWidth,
        this.viewerHeight,
        this.viewport3d,
        window,
        () => {
          this.isLoaded = true;
          this.updateBounds();
          this.$emit('model:loaded', this.viewer);
        },
        object3d => this.$emit('object:clicked', object3d)
      );
      this.viewer.onContextMenuCallback = this.handleContextMenu.bind(this);
      this.viewer.onNavigationChange = (isNavigating) => {
        this.isViewerNavigating = isNavigating;
      };
      this.viewer.onModifierChange = (isModifierActive) => {
        this.isNavModifierActive = isModifierActive;
      };
      this.viewer.onSectionChangeCallback = ({ offset }) => {
        this.sectionOffset = Number(offset.toFixed(2));
      };
      if (typeof this.viewer.setDarkTheme === 'function') {
        this.viewer.setDarkTheme(this.isDark);
      }
      if (typeof this.viewer.setNavigationStyle === 'function') {
        this.viewer.setNavigationStyle(this.navigationStyle);
      }
      this.viewport3d.appendChild(this.viewer.renderer.domElement);
    },

    updateBounds() {
      if (!this.viewer) return;
      const bounds = this.viewer.getModelBounds();
      let minVal, maxVal, centerVal;
      if (this.sectionAxis === 'x') {
        minVal = bounds.min.x;
        maxVal = bounds.max.x;
        centerVal = bounds.center.x;
      } else if (this.sectionAxis === 'y') {
        minVal = bounds.min.y;
        maxVal = bounds.max.y;
        centerVal = bounds.center.y;
      } else {
        minVal = bounds.min.z;
        maxVal = bounds.max.z;
        centerVal = bounds.center.z;
      }

      const pad = Math.max(1, (maxVal - minVal) * 0.05);
      this.sectionMin = Math.floor(minVal - pad);
      this.sectionMax = Math.ceil(maxVal + pad);
      const span = this.sectionMax - this.sectionMin;
      this.sectionStep = span > 500 ? 1 : span > 100 ? 0.5 : 0.1;
      this.sectionOffset = Number(centerVal.toFixed(1));
    },

    toggleSection() {
      if (!this.sectionActive) {
        this.sectionActive = true;
        this.sectionPanelOpen = true;
        this.bringToFront('section');
        this.$emit('section:changed', true);
        this.updateBounds();
        this.applySection();
      } else {
        this.sectionPanelOpen = !this.sectionPanelOpen;
        if (this.sectionPanelOpen) {
          this.bringToFront('section');
        }
        this.applySection();
      }
    },

    closePanel() {
      this.sectionPanelOpen = false;
      this.applySection();
    },

    deactivateSection() {
      this.sectionActive = false;
      this.sectionPanelOpen = false;
      this.$emit('section:changed', false);
      this.applySection();
    },

    onAxisChange() {
      this.updateBounds();
      this.applySection();
    },

    onOffsetChange() {
      this.applySection();
    },

    toggleInvert() {
      this.sectionInvert = !this.sectionInvert;
      this.applySection();
    },

    resetToCenter() {
      if (!this.viewer) return;
      const bounds = this.viewer.getModelBounds();
      let centerVal = 0;
      if (this.sectionAxis === 'x') centerVal = bounds.center.x;
      else if (this.sectionAxis === 'y') centerVal = bounds.center.y;
      else centerVal = bounds.center.z;
      this.sectionOffset = Number(centerVal.toFixed(1));
      this.applySection();
    },

    onShowPlaneChange() {
      this.applySection();
    },

    applySection() {
      if (!this.viewer) return;
      const isPanelOpen = !!this.sectionPanelOpen;
      this.viewer.setSectionAnalysis({
        active: this.sectionActive,
        axis: this.sectionAxis,
        offset: Number(this.sectionOffset),
        invert: this.sectionInvert,
        showPlane: this.sectionShowPlane && isPanelOpen,
        showGizmo: this.sectionShowGizmo && isPanelOpen,
        showHatch: this.sectionShowHatch,
        hatchStyle: this.sectionHatchStyle,
        hatchDensity: Number(this.sectionHatchDensity),
        paletteMode: this.sectionPaletteMode
      });
    },

    fitModelToScreen() {
      this.viewer.fitCameraToObjects();
    },

    reloadOBJ(objUrl) {
      this.objUrl = objUrl;
      this.viewer.url = objUrl;
      this.viewer.loadOBJ();
    },

    setNavStyle(style) {
      this.navigationStyle = style;
      try {
        localStorage.setItem('ondsel_nav_style', style);
      } catch (_) {}
      if (this.viewer && typeof this.viewer.setNavigationStyle === 'function') {
        this.viewer.setNavigationStyle(style);
      }
      this.navMenuOpen = false;
      this.snackbarText = `3D Navigation: ${this.navStyleTitle}`;
      this.snackbar = true;
    },

    toggleMeasurement() {
      if (!this.measureActive) {
        this.measureActive = true;
        this.measurePanelOpen = true;
        this.bringToFront('measure');
        this.sectionPanelOpen = false; // focus on measurement panel
        this.applySection();
        if (this.viewer) {
          this.viewer.activateMeasurement(this.handleMeasurementUpdate.bind(this));
          this.viewer.setMeasurementMode(this.measureMode);
          if (this.viewer.measurementTool) {
            this.viewer.measurementTool.setXray(this.measureXray);
            this.viewer.measurementTool.setKeepMeasurementsOnExit(this.keepMeasurementsOnExit);
          }
        }
        this.$emit('measure:changed', true);
      } else {
        this.measurePanelOpen = !this.measurePanelOpen;
        if (this.measurePanelOpen) {
          this.bringToFront('measure');
        }
      }
    },

    toggleMeasureXray() {
      this.measureXray = !this.measureXray;
      if (this.viewer && this.viewer.measurementTool) {
        this.viewer.measurementTool.setXray(this.measureXray);
      }
    },

    toggleKeepMeasurements(val) {
      this.keepMeasurementsOnExit = !!val;
      if (this.viewer && this.viewer.setKeepMeasurementsOnExit) {
        this.viewer.setKeepMeasurementsOnExit(this.keepMeasurementsOnExit);
      }
    },

    commitAndNewMeasurement() {
      if (this.viewer && this.viewer.commitMeasurement) {
        this.viewer.commitMeasurement();
      }
      this.currentMeasurement = null;
      this.firstSelectionSnap = null;
    },

    deleteMeasurement(id) {
      if (this.viewer && this.viewer.deleteMeasurement) {
        this.viewer.deleteMeasurement(id);
      }
    },

    clearAllMeasurements() {
      if (this.viewer && this.viewer.clearAllMeasurements) {
        this.viewer.clearAllMeasurements();
      }
      this.currentMeasurement = null;
      this.measurementBadges = [];
      this.savedMeasurements = [];
      this.firstSelectionSnap = null;
      this.measurePrompt = '';
    },

    deactivateMeasurement() {
      this.measureActive = false;
      this.measurePanelOpen = false;
      this.firstSelectionSnap = null;
      this.measurePrompt = '';
      this.radiusPointsCount = 0;
      if (this.viewer) {
        this.viewer.deactivateMeasurement();
      }
      if (!this.keepMeasurementsOnExit) {
        this.currentMeasurement = null;
        this.measurementBadges = [];
        this.savedMeasurements = [];
      }
      this.$emit('measure:changed', false);
    },

    onMeasureModeChange(mode) {
      this.measureMode = mode;
      this.currentMeasurement = null;
      this.firstSelectionSnap = null;
      this.measurePrompt = '';
      this.radiusPointsCount = 0;
      if (this.viewer) {
        this.viewer.setMeasurementMode(mode);
      }
    },

    resetMeasurement() {
      this.currentMeasurement = null;
      this.firstSelectionSnap = null;
      this.measurePrompt = '';
      this.radiusPointsCount = 0;
      if (this.viewer) {
        this.viewer.resetMeasurement();
      }
    },

    clearMeasurementVisuals() {
      this.clearAllMeasurements();
    },

    handleMeasurementUpdate(data) {
      this.currentMeasurement = data.measurement;
      this.measurementBadges = data.badges || [];
      this.savedMeasurements = data.savedMeasurements || [];
      this.firstSelectionSnap = data.firstSelection;
      this.measurePrompt = data.prompt || '';
      this.radiusPointsCount = data.radiusPointsCount || 0;
      if (data.keepMeasurementsOnExit !== undefined) {
        this.keepMeasurementsOnExit = data.keepMeasurementsOnExit;
      }
    },

    startDragBadge(event, badge) {
      if (event.button !== 0 || event.altKey || event.shiftKey) {
        if (this.viewer && this.viewer.renderer && this.viewer.renderer.domElement) {
          const dom = this.viewer.renderer.domElement;
          const simulatedEvent = new PointerEvent(event.type, event);
          dom.dispatchEvent(simulatedEvent);
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();

      if (this.viewer && this.viewer.measurementTool && typeof this.viewer.measurementTool.update === 'function') {
        this.viewer.measurementTool.update();
      }

      this.isDraggingBadge = badge.id;
      const startMouseX = event.clientX;
      const startMouseY = event.clientY;
      const startOffsetX = badge.offsetX || 0;
      const startOffsetY = badge.offsetY || 0;

      if (this.viewer && this.viewer.controls) {
        this.viewer.controls.enabled = false;
      }

      const onPointerMove = (e) => {
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        badge.offsetX = startOffsetX + dx;
        badge.offsetY = startOffsetY + dy;

        const el = document.getElementById('badge-' + badge.id);
        if (el) {
          el.style.left = (badge.screenX + badge.offsetX) + 'px';
          el.style.top = (badge.screenY + badge.offsetY) + 'px';
        }

        const hasOffset = Math.abs(badge.offsetX) > 4 || Math.abs(badge.offsetY) > 4;
        const svgLine = document.getElementById('badge-line-' + badge.id);
        if (svgLine) {
          svgLine.style.display = hasOffset ? 'block' : 'none';
          svgLine.setAttribute('x1', badge.screenX);
          svgLine.setAttribute('y1', badge.screenY);
          svgLine.setAttribute('x2', badge.screenX + badge.offsetX);
          svgLine.setAttribute('y2', badge.screenY + badge.offsetY);
        }
        const svgDot = document.getElementById('badge-dot-' + badge.id);
        if (svgDot) {
          svgDot.style.display = hasOffset ? 'block' : 'none';
          svgDot.setAttribute('cx', badge.screenX);
          svgDot.setAttribute('cy', badge.screenY);
        }
      };

      const onPointerUp = () => {
        this.isDraggingBadge = null;
        if (this.viewer && this.viewer.controls) {
          this.viewer.controls.enabled = true;
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },

    resetBadgeOffset(badge) {
      badge.offsetX = 0;
      badge.offsetY = 0;
      const el = document.getElementById('badge-' + badge.id);
      if (el) {
        el.style.left = badge.screenX + 'px';
        el.style.top = badge.screenY + 'px';
      }
      const svgLine = document.getElementById('badge-line-' + badge.id);
      if (svgLine) svgLine.style.display = 'none';
      const svgDot = document.getElementById('badge-dot-' + badge.id);
      if (svgDot) svgDot.style.display = 'none';
    },

    handleBadgeWheel(event) {
      if (this.viewer && this.viewer.renderer && this.viewer.renderer.domElement) {
        this.viewer.renderer.domElement.dispatchEvent(new WheelEvent('wheel', event));
      }
    },

    getSelectionPrompt() {
      if (this.firstSelectionSnap) {
        return 'Select the second element (point, edge, face or bore)...';
      }
      if (this.measureMode === 'planes') {
        return 'Click on the first planar face...';
      }
      if (this.measureMode === 'lines') {
        return 'Click on the first edge or straight line...';
      }
      if (this.measureMode === 'radius') {
        return 'Click on a bore, cylinder or curved edge...';
      }
      if (this.measureMode === 'distance') {
        return 'Click on the first point or vertex...';
      }
      return 'Click on any face, edge, bore or point...';
    },

    async copyToClipboard(text) {
      if (!text) return false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = text;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          textArea.style.top = '-999999px';
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          textArea.remove();
        }
        return true;
      } catch (err) {
        console.error('[CAD Measure] Error copying to clipboard:', err);
        return false;
      }
    },

    async copyMeasurementValue(text, targetId = 'primary') {
      const ok = await this.copyToClipboard(text);
      if (ok) {
        this.copiedTarget = targetId;
        this.snackbarText = `Copied: ${text}`;
        this.snackbar = true;
        setTimeout(() => {
          if (this.copiedTarget === targetId) {
            this.copiedTarget = null;
          }
        }, 1800);
      }
    },

    async copyAllMeasurement() {
      if (!this.currentMeasurement) return;
      const m = this.currentMeasurement;
      const lines = [
        `=== CAD Measurement: ${m.title} ===`,
        `Primary Result: ${m.primaryValue}`
      ];
      if (m.secondaryValue) {
        lines.push(`Secondary Information: ${m.secondaryValue}`);
      }
      if (m.details && m.details.length > 0) {
        lines.push(`Technical Details:`);
        m.details.forEach(d => {
          lines.push(`  • ${d.label}: ${d.value}`);
        });
      }
      const text = lines.join('\n');
      const ok = await this.copyToClipboard(text);
      if (ok) {
        this.copiedTarget = 'all';
        this.snackbarText = 'Complete measurement report copied to clipboard!';
        this.snackbar = true;
        setTimeout(() => {
          if (this.copiedTarget === 'all') {
            this.copiedTarget = null;
          }
        }, 1800);
      }
    },

    showSnackbar(text) {
      this.snackbarText = text;
      this.snackbar = true;
    },

    handleContextMenu({ clientX, clientY, modelObject }) {
      this.contextMenu.x = clientX;
      this.contextMenu.y = clientY;
      this.contextMenu.modelObject = modelObject ? markRaw(modelObject) : null;
      this.contextMenu.hasIsolatedActive = !!(this.viewer && this.viewer.isolatedObject);

      if (modelObject) {
        if (this.viewer && !this.viewer.selectedObjs.some(o => o.uuid === modelObject.uuid)) {
          this.viewer.clearSelection(false);
          this.viewer.selectGivenObject(modelObject, true);
        }

        const color = modelObject.GetColor ? modelObject.GetColor() : null;
        this.contextMenu.colorHex = color ? '#' + color.getHexString() : '#00e5ff';
        this.contextMenu.targetName = modelObject.name || 'CAD Part';
        this.contextMenu.targetType = modelObject.GetType ? modelObject.GetType() : (modelObject.type || 'Shape');
        this.contextMenu.isVisible = modelObject.GetVisibility ? modelObject.GetVisibility() : true;
        this.contextMenu.isIsolated = this.viewer ? !!(this.viewer.isolatedObject && this.viewer.isolatedObject.uuid === modelObject.uuid) : false;
        this.contextMenu.currentOpacity = modelObject.opacityLevel !== undefined ? modelObject.opacityLevel : 1.0;
      } else {
        this.contextMenu.targetName = '';
        this.contextMenu.targetType = '';
      }

      this.contextMenu.show = true;
    },

    isolatePart(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.isolateObject(modelObject);
      this.contextMenu.show = false;
      this.showSnackbar(`Part isolated: ${modelObject.name || 'CAD'}`);
    },

    restoreIsolation() {
      if (!this.viewer) return;
      this.viewer.restoreIsolation();
      this.contextMenu.show = false;
      this.showSnackbar('Isolation cleared. Showing all parts.');
    },

    hidePart(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.hideObject(modelObject);
      this.contextMenu.show = false;
      this.showSnackbar(`Part hidden: ${modelObject.name || 'CAD'}`);
    },

    showPart(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.showObject(modelObject);
      this.contextMenu.show = false;
      this.showSnackbar(`Part visible: ${modelObject.name || 'CAD'}`);
    },

    togglePartVisibility(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.toggleObjectVisibility(modelObject);
      const isVisible = modelObject.GetVisibility ? modelObject.GetVisibility() : true;
      this.contextMenu.show = false;
      this.showSnackbar(isVisible ? `Part visible: ${modelObject.name || 'CAD'}` : `Part hidden: ${modelObject.name || 'CAD'}`);
    },

    showAllParts() {
      if (!this.viewer) return;
      this.viewer.showAllObjects();
      this.contextMenu.show = false;
      this.showSnackbar('All parts are visible');
    },

    setPartOpacity(modelObject, opacity) {
      if (!this.viewer || !modelObject) return;
      this.viewer.setObjectOpacity(modelObject, opacity);
      this.contextMenu.currentOpacity = opacity;
      this.showSnackbar(`Opacity of "${modelObject.name || 'part'}" set to ${Math.round(opacity * 100)}%`);
    },

    resetAllOpacities() {
      if (!this.viewer) return;
      this.viewer.resetAllOpacities();
      this.contextMenu.show = false;
      this.showSnackbar('All opacities reset to 100%');
    },

    zoomToPart(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.fitCameraToObject(modelObject);
      this.contextMenu.show = false;
    },

    clearSelection() {
      if (!this.viewer) return;
      this.viewer.clearSelection(true);
      this.contextMenu.show = false;
    },

    openPartInfo(modelObject) {
      if (!this.viewer || !modelObject) return;
      const props = this.viewer.getObjectProperties(modelObject);
      this.selectedPartProps = props;
      this.partPropertiesDialog = true;
      this.contextMenu.show = false;
    },

    copyPartName(modelObject) {
      if (!modelObject) return;
      const name = modelObject.name || '';
      navigator.clipboard.writeText(name);
      this.contextMenu.show = false;
      this.showSnackbar(`Name copied: "${name}"`);
    },

    copyAllProperties(props) {
      if (!props) return;
      const lines = [
        `=== CAD PROPERTIES ===`,
        `Name: ${props.name}`,
        props.realName ? `Real Name: ${props.realName}` : null,
        `Type: ${props.type}`,
        `UUID: ${props.uuid}`,
        `--- DIMENSIONS ---`,
        `Length X: ${props.sizeX.toFixed(2)} mm`,
        `Width Y: ${props.sizeY.toFixed(2)} mm`,
        `Height Z: ${props.sizeZ.toFixed(2)} mm`,
        `Bounding Box Volume: ${((props.sizeX * props.sizeY * props.sizeZ) / 1000).toFixed(2)} cm³`,
        `Center: [${props.centerX.toFixed(2)}, ${props.centerY.toFixed(2)}, ${props.centerZ.toFixed(2)}] mm`,
        `--- TOPOLOGY ---`,
        `Triangles: ${props.triangleCount.toLocaleString()}`,
        `Vertices: ${props.vertexCount.toLocaleString()}`,
        `Submeshes: ${props.meshCount}`,
        `Visibility: ${props.visible ? 'Visible' : 'Hidden'}`,
        `Opacity: ${Math.round(props.opacity * 100)}%`,
        `Base Color: ${props.colorHex}`
      ].filter(Boolean);

      if (props.fcProperties && props.fcProperties.length > 0) {
        lines.push('--- FREECAD PROPERTIES ---');
        props.fcProperties.forEach(p => lines.push(`${p.name}: ${p.value}`));
      }

      navigator.clipboard.writeText(lines.join('\n'));
      this.showSnackbar('All properties copied to clipboard');
    },

    loadSavedPanelPositions() {
      try {
        const savedMeasure = localStorage.getItem('ondsel_measure_panel_pos');
        if (savedMeasure) {
          const parsed = JSON.parse(savedMeasure);
          if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
            this.measurePanelPos = parsed;
          }
        }
      } catch (e) {}

      try {
        const savedSection = localStorage.getItem('ondsel_section_panel_pos');
        if (savedSection) {
          const parsed = JSON.parse(savedSection);
          if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
            this.sectionPanelPos = parsed;
          }
        }
      } catch (e) {}
    },

    clampPanelPositions() {
      if (!this.$el) return;
      const containerRect = this.$el.getBoundingClientRect();
      if (!containerRect.width || !containerRect.height) return;

      const clampCard = (selector, posKey) => {
        const pos = this[posKey];
        if (!pos || pos.x === null || pos.y === null) return;
        const cardEl = this.$el.querySelector(selector);
        const cardWidth = cardEl ? cardEl.offsetWidth : 350;
        const cardHeight = cardEl ? cardEl.offsetHeight : 200;

        const maxLeft = Math.max(8, containerRect.width - cardWidth - 8);
        const maxTop = Math.max(8, containerRect.height - Math.min(cardHeight, 48) - 8);

        let newTop = pos.y;
        if (newTop + cardHeight > containerRect.height - 8) {
          newTop = Math.max(8, containerRect.height - cardHeight - 8);
        }
        newTop = Math.max(8, Math.min(newTop, maxTop));
        const newLeft = Math.max(8, Math.min(pos.x, maxLeft));

        this[posKey] = { x: Math.round(newLeft), y: Math.round(newTop) };
      };

      clampCard('.measurement-panel-card', 'measurePanelPos');
      clampCard('.section-analysis-card', 'sectionPanelPos');
    },

    bringToFront(panelType) {
      this.highestPanelZIndex = Math.max(this.highestPanelZIndex || 15, 15) + 1;
      if (!this.panelZIndices) {
        this.panelZIndices = { measure: 15, section: 15 };
      }
      this.panelZIndices[panelType] = this.highestPanelZIndex;
    },

    togglePanelCollapse(panelType) {
      if (panelType === 'measure') {
        this.measurePanelCollapsed = !this.measurePanelCollapsed;
      } else {
        this.sectionPanelCollapsed = !this.sectionPanelCollapsed;
      }
      this.$nextTick(() => {
        setTimeout(() => {
          this.clampPanelPositions();
        }, 250);
      });
    },

    toggleMinimalistMode() {
      this.minimalistMode = !this.minimalistMode;
      try {
        localStorage.setItem('ondsel_minimalist_mode', this.minimalistMode ? 'true' : 'false');
      } catch (e) {}
      this.$nextTick(() => {
        setTimeout(() => {
          this.clampPanelPositions();
        }, 150);
      });
    },

    startDragPanel(event, panelType) {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      if (event.target && event.target.closest('button, input, select, textarea, .v-btn, .v-switch, .v-btn-toggle')) {
        return;
      }
      event.preventDefault();
      this.bringToFront(panelType);

      const card = event.currentTarget.closest('.v-card');
      const container = this.$el;
      if (!card || !container) return;

      const cardRect = card.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const currentLeft = cardRect.left - containerRect.left;
      const currentTop = cardRect.top - containerRect.top;
      const startMouseX = event.clientX;
      const startMouseY = event.clientY;

      this.isDraggingPanel = panelType;
      card.classList.add('panel-dragging');

      if (this.viewer && this.viewer.controls) {
        this.viewer.controls.enabled = false;
      }

      let lastPos = null;

      const onPointerMove = (e) => {
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;
        let newX = currentLeft + dx;
        let newY = currentTop + dy;

        const maxLeft = Math.max(8, containerRect.width - cardRect.width - 8);
        const maxTop = Math.max(8, containerRect.height - 40);

        newX = Math.max(8, Math.min(newX, maxLeft));
        newY = Math.max(8, Math.min(newY, maxTop));

        card.style.left = `${newX}px`;
        card.style.top = `${newY}px`;
        card.style.bottom = 'auto';

        lastPos = { x: Math.round(newX), y: Math.round(newY) };
      };

      const onPointerUp = () => {
        this.isDraggingPanel = null;
        card.classList.remove('panel-dragging');

        if (this.viewer && this.viewer.controls) {
          this.viewer.controls.enabled = true;
        }

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (lastPos) {
          if (panelType === 'measure') {
            this.measurePanelPos = lastPos;
          } else {
            this.sectionPanelPos = lastPos;
          }
          try {
            localStorage.setItem(`ondsel_${panelType}_panel_pos`, JSON.stringify(lastPos));
          } catch (e) {}
        }
      };

      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },

    resetPanelPos(panelType) {
      if (panelType === 'measure') {
        this.measurePanelPos = { x: null, y: null };
      } else {
        this.sectionPanelPos = { x: null, y: null };
      }
      try {
        localStorage.removeItem(`ondsel_${panelType}_panel_pos`);
      } catch (e) {}
      this.showSnackbar('Panel position reset');
    },

    getSectionPanelStyle() {
      const isDragging = this.isDraggingPanel === 'section';
      const base = {
        position: 'absolute',
        width: this.minimalistMode ? '320px' : '360px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
        zIndex: this.panelZIndices?.section || 15,
        backdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(var(--v-theme-surface), 0.95)',
        color: 'rgb(var(--v-theme-on-surface))',
        border: '1px solid rgba(var(--v-theme-on-surface), 0.12)',
        boxShadow: isDragging ? '0 12px 40px rgba(0,0,0,0.45)' : '0 8px 32px rgba(0,0,0,0.25)',
        userSelect: isDragging ? 'none' : 'auto',
      };

      if (this.sectionPanelPos && this.sectionPanelPos.x !== null && this.sectionPanelPos.y !== null) {
        base.left = `${this.sectionPanelPos.x}px`;
        base.top = `${this.sectionPanelPos.y}px`;
        base.bottom = 'auto';
      } else {
        base.bottom = '84px';
        base.left = '24px';
        base.top = 'auto';
      }

      return base;
    },

    getMeasurePanelStyle() {
      const isDragging = this.isDraggingPanel === 'measure';
      const base = {
        position: 'absolute',
        width: this.minimalistMode ? '340px' : '400px',
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 100px)',
        overflowY: 'auto',
        zIndex: this.panelZIndices?.measure || 15,
        backdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(var(--v-theme-surface), 0.96)',
        color: 'rgb(var(--v-theme-on-surface))',
        border: '1px solid rgba(var(--v-theme-on-surface), 0.12)',
        boxShadow: isDragging ? '0 12px 40px rgba(0,0,0,0.45)' : '0 8px 32px rgba(0,0,0,0.25)',
        userSelect: isDragging ? 'none' : 'auto',
      };

      if (this.measurePanelPos && this.measurePanelPos.x !== null && this.measurePanelPos.y !== null) {
        base.left = `${this.measurePanelPos.x}px`;
        base.top = `${this.measurePanelPos.y}px`;
        base.bottom = 'auto';
      } else {
        const isSectionAtDefault = this.sectionPanelOpen && (!this.sectionPanelPos || this.sectionPanelPos.x === null);
        const desiredLeft = isSectionAtDefault ? (this.minimalistMode ? 344 : 380) : 24;
        const maxDefaultLeft = Math.max(24, (typeof window !== 'undefined' ? window.innerWidth : 1280) - (this.minimalistMode ? 356 : 416));
        base.bottom = '84px';
        base.left = `${Math.min(desiredLeft, maxDefaultLeft)}px`;
        base.top = 'auto';
      }

      return base;
    },

  }
}
</script>

<style scoped>
.status-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #4caf50;
  box-shadow: 0 0 8px rgba(76, 175, 80, 0.8);
  display: inline-block;
  flex-shrink: 0;
}
.measurement-detail-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
}
.measurement-badges-container {
  pointer-events: none;
}
.panel-drag-header {
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
.panel-drag-header:active {
  cursor: grabbing;
}
.panel-dragging {
  cursor: grabbing !important;
  user-select: none;
}
.drag-handle-icon {
  opacity: 0.5;
  transition: opacity 0.2s;
}
.panel-drag-header:hover .drag-handle-icon {
  opacity: 0.9;
}
.drag-title-area {
  cursor: grab;
}
.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}
.panel-action-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  min-height: 26px !important;
  padding: 0 !important;
  border-radius: 6px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  transition: background-color 0.15s ease, color 0.15s ease, transform 0.1s ease !important;
}
.panel-action-btn:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.1) !important;
}
.panel-action-btn:active {
  transform: scale(0.92);
}
.panel-header-divider {
  width: 1px;
  height: 14px;
  background-color: rgba(var(--v-theme-on-surface), 0.22);
  margin: 0 4px;
  flex-shrink: 0;
}
</style>
