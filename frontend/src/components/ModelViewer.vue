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
          {{ !sectionActive ? 'Activar análisis de sección (Cortes 3D)' : (sectionPanelOpen ? 'Ocultar panel de corte' : 'Abrir controles de corte (Corte activo)') }}
        </v-tooltip>
      </v-btn>

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
          {{ !measureActive ? 'Herramienta de medición CAD (Planos, Radios, Líneas)' : (measurePanelOpen ? 'Ocultar panel de medición' : 'Abrir panel de medición (Activo)') }}
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
          pointerEvents: 'auto',
          cursor: isDraggingBadge === badge.id ? 'grabbing' : 'grab',
          zIndex: isDraggingBadge === badge.id ? 20 : 13
        }"
        @pointerdown="startDragBadge($event, badge)"
        @dblclick.stop="resetBadgeOffset(badge)"
        title="Arrastra para mover la etiqueta y despejar la vista. Doble clic para centrar."
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
            title="Eliminar esta cota"
          >
            <v-icon size="12">mdi-close</v-icon>
          </v-btn>
        </v-chip>
      </div>
    </div>

    <!-- Floating Persistent Cotas Indicator (visible when tool panel is closed but cotas exist) -->
    <v-chip
      v-if="!measureActive && visibleMeasurementBadges && visibleMeasurementBadges.length > 0"
      color="primary"
      variant="elevated"
      elevation="4"
      size="small"
      class="persistent-cotas-pill font-weight-medium"
      style="position: absolute; bottom: 84px; left: 24px; z-index: 10; backdrop-filter: blur(8px);"
    >
      <v-icon start size="small">mdi-ruler</v-icon>
      {{ visibleMeasurementBadges.length }} {{ visibleMeasurementBadges.length === 1 ? 'cota en pantalla' : 'cotas en pantalla' }}
      <v-btn
        variant="text"
        size="x-small"
        class="ml-1 font-weight-bold text-caption text-decoration-underline"
        @click.stop="clearAllMeasurements"
      >
        Limpiar
      </v-btn>
      <v-btn
        variant="text"
        size="x-small"
        class="ml-1 font-weight-bold text-caption text-decoration-underline"
        @click.stop="toggleMeasurement"
      >
        Medir más
      </v-btn>
    </v-chip>

    <!-- Floating Section Analysis Dialog/Panel -->
    <v-fade-transition>
      <v-card
        v-if="sectionPanelOpen"
        class="section-analysis-card"
        elevation="8"
        rounded="lg"
        style="position: absolute; bottom: 84px; left: 24px; width: 350px; z-index: 15; backdrop-filter: blur(12px); background-color: rgba(var(--v-theme-surface), 0.95); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.12); box-shadow: 0 8px 32px rgba(0,0,0,0.25);"
      >
        <v-card-item class="pb-1 pt-3">
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-vector-intersection</v-icon>
              <span class="text-subtitle-2 font-weight-bold">Análisis de Sección</span>
              <v-chip size="x-small" color="success" class="ml-2 font-weight-medium" variant="tonal">Activo</v-chip>
            </div>
            <div class="d-flex align-center">
              <v-btn
                icon="mdi-power"
                variant="text"
                size="x-small"
                color="error"
                class="mr-1"
                @click="deactivateSection"
              >
                <v-icon>mdi-power</v-icon>
                <v-tooltip activator="parent" location="top">Desactivar y quitar corte</v-tooltip>
              </v-btn>
              <v-btn
                icon="mdi-close"
                variant="text"
                size="x-small"
                @click="closePanel"
              >
                <v-icon>mdi-close</v-icon>
                <v-tooltip activator="parent" location="top">Ocultar panel (el corte queda permanente)</v-tooltip>
              </v-btn>
            </div>
          </div>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <!-- Eje de corte -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">PLANO DE CORTE</div>
          <v-btn-toggle
            v-model="sectionAxis"
            mandatory
            density="compact"
            color="primary"
            class="w-100 mb-3"
            @update:model-value="onAxisChange"
          >
            <v-btn value="x" class="flex-grow-1" size="small">Plano X</v-btn>
            <v-btn value="y" class="flex-grow-1" size="small">Plano Y</v-btn>
            <v-btn value="z" class="flex-grow-1" size="small">Plano Z</v-btn>
          </v-btn-toggle>

          <!-- Slider de posición -->
          <div class="d-flex justify-space-between align-center mb-1">
            <span class="text-caption font-weight-bold text-medium-emphasis">DESPLAZAMIENTO</span>
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

          <!-- Acciones Invertir / Centrar -->
          <div class="d-flex justify-space-between align-center mb-2">
            <v-btn
              size="small"
              :variant="sectionInvert ? 'flat' : 'outlined'"
              :color="sectionInvert ? 'primary' : undefined"
              prepend-icon="mdi-swap-horizontal"
              @click="toggleInvert"
            >
              Invertir corte
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-restart"
              @click="resetToCenter"
            >
              Centrar
            </v-btn>
          </div>

          <!-- Rayado de corte técnico (Hatch) -->
          <v-divider class="my-2"></v-divider>

          <v-checkbox
            v-model="sectionShowHatch"
            label="Rayado de corte (Hatch)"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="applySection"
          ></v-checkbox>

          <v-fade-transition>
            <div v-if="sectionShowHatch" class="mb-2 pl-1 pr-1">
              <div class="d-flex justify-space-between align-center my-1">
                <span class="text-caption text-medium-emphasis">PATRÓN HATCH</span>
                <v-btn-toggle
                  v-model="sectionHatchStyle"
                  mandatory
                  density="compact"
                  color="primary"
                  @update:model-value="applySection"
                >
                  <v-btn value="diagonal" size="x-small">45° ANSI</v-btn>
                  <v-btn value="cross" size="x-small">Malla</v-btn>
                  <v-btn value="solid" size="x-small">Liso</v-btn>
                </v-btn-toggle>
              </div>

              <!-- Tonalidad de corte: Pastel (por defecto) o Intenso -->
              <div class="d-flex justify-space-between align-center my-1">
                <span class="text-caption text-medium-emphasis">TONALIDAD</span>
                <v-btn-toggle
                  v-model="sectionPaletteMode"
                  mandatory
                  density="compact"
                  color="primary"
                  @update:model-value="applySection"
                >
                  <v-btn value="pastel" size="x-small">Pastel</v-btn>
                  <v-btn value="vivid" size="x-small">Intenso</v-btn>
                </v-btn-toggle>
              </div>

              <!-- Slider de tamaño/espaciado de líneas de corte -->
              <div v-if="sectionHatchStyle !== 'solid'" class="mt-2">
                <div class="d-flex justify-space-between align-center mb-1">
                  <span class="text-caption text-medium-emphasis">TAMAÑO RAYADO</span>
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

          <!-- Guía visual 3D -->
          <v-checkbox
            v-model="sectionShowPlane"
            label="Mostrar plano guía 3D"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="applySection"
          ></v-checkbox>

          <!-- Manipulador 3D en pantalla (Gizmo) -->
          <v-checkbox
            v-model="sectionShowGizmo"
            label="Manipulador 3D (Gizmo de corte)"
            density="compact"
            hide-details
            color="primary"
            @update:model-value="applySection"
          ></v-checkbox>
        </v-card-text>
      </v-card>
    </v-fade-transition>

    <!-- Floating CAD Measurement Dialog/Panel -->
    <v-fade-transition>
      <v-card
        v-if="measurePanelOpen"
        class="measurement-panel-card"
        elevation="8"
        rounded="lg"
        style="position: absolute; bottom: 84px; left: 24px; width: 390px; max-width: calc(100vw - 48px); z-index: 15; backdrop-filter: blur(12px); background-color: rgba(var(--v-theme-surface), 0.96); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.12); box-shadow: 0 8px 32px rgba(0,0,0,0.25);"
      >
        <v-card-item class="pb-1 pt-3">
          <div class="d-flex justify-space-between align-center">
            <div class="d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-ruler-square</v-icon>
              <span class="text-subtitle-2 font-weight-bold">Medición CAD</span>
              <v-chip size="x-small" color="primary" class="ml-2 font-weight-medium" variant="tonal">Activo</v-chip>
            </div>
            <div class="d-flex align-center">
              <v-btn
                icon
                variant="text"
                size="x-small"
                class="mr-1"
                :color="measureXray ? 'warning' : undefined"
                @click="toggleMeasureXray"
              >
                <v-icon size="16">{{ measureXray ? 'mdi-eye-outline' : 'mdi-eye-off-outline' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ measureXray ? 'Rayos X: Activo (visible a través de piezas)' : 'Oclusión 3D: Activa (oculto tras piezas sólidas)' }}
                </v-tooltip>
              </v-btn>
              <v-btn
                v-if="currentMeasurement"
                icon
                variant="text"
                size="x-small"
                class="mr-1"
                :color="copiedTarget === 'all' ? 'success' : undefined"
                @click="copyAllMeasurement"
              >
                <v-icon size="16">{{ copiedTarget === 'all' ? 'mdi-check' : 'mdi-clipboard-text-outline' }}</v-icon>
                <v-tooltip activator="parent" location="top">
                  {{ copiedTarget === 'all' ? '¡Informe copiado!' : 'Copiar informe completo' }}
                </v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                size="x-small"
                color="error"
                class="mr-1"
                @click="deactivateMeasurement"
              >
                <v-icon size="16">mdi-power</v-icon>
                <v-tooltip activator="parent" location="top">Cerrar y desactivar medición</v-tooltip>
              </v-btn>
              <v-btn
                icon
                variant="text"
                size="x-small"
                @click="measurePanelOpen = false"
              >
                <v-icon size="16">mdi-close</v-icon>
                <v-tooltip activator="parent" location="top">Ocultar panel (las cotas se mantienen)</v-tooltip>
              </v-btn>
            </div>
          </div>
        </v-card-item>

        <v-card-text class="pt-2 pb-3">
          <!-- Modo de medición -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">TIPO DE MEDICIÓN</div>
          <v-btn-toggle
            v-model="measureMode"
            mandatory
            density="compact"
            color="primary"
            class="w-100 mb-3"
            @update:model-value="onMeasureModeChange"
          >
            <v-btn value="smart" class="flex-grow-1" size="small">Auto</v-btn>
            <v-btn value="planes" class="flex-grow-1" size="small">Planos</v-btn>
            <v-btn value="lines" class="flex-grow-1" size="small">Líneas</v-btn>
            <v-btn value="radius" class="flex-grow-1" size="small">Radio / Ø</v-btn>
            <v-btn value="distance" class="flex-grow-1" size="small">3D</v-btn>
          </v-btn-toggle>

          <!-- Prompt de interacción / Estado de selección -->
          <div
            v-if="!currentMeasurement"
            class="pa-3 rounded mb-3"
            style="background-color: rgba(var(--v-theme-surface-soft), 0.85); border: 1px solid rgba(var(--v-theme-on-surface), 0.1); color: rgb(var(--v-theme-on-surface));"
          >
            <div v-if="firstSelectionSnap" class="d-flex align-center mb-1">
              <v-chip size="x-small" color="primary" class="mr-2 font-weight-bold" variant="flat">
                Paso 1 Fijado
              </v-chip>
              <span class="text-caption font-weight-medium" style="color: rgb(var(--v-theme-on-surface));">
                {{ firstSelectionSnap.type === 'face' ? 'Cara plana' : (firstSelectionSnap.type === 'vertex' ? 'Punto / Vértice' : (firstSelectionSnap.type === 'edge' ? 'Línea / Arista' : (firstSelectionSnap.type === 'cylinder' ? 'Cilindro / Círculo' : 'Punto'))) }}
              </span>
            </div>
            <div v-if="measureMode === 'radius' && radiusPointsCount > 0" class="d-flex align-center mb-1">
              <v-chip size="x-small" color="primary" class="mr-2 font-weight-bold" variant="flat">
                {{ radiusPointsCount }}/3 Puntos
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
              <span>Clic izquierdo: seleccionar | Clic derecho: rotar pieza</span>
            </div>
          </div>

          <!-- Resultado de la medición actual con botones de copia -->
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

            <!-- Valor principal con botón de copia destacado -->
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
                  {{ copiedTarget === 'primary' ? '¡Valor copiado!' : 'Copiar valor principal' }}
                </v-tooltip>
              </v-btn>
            </div>

            <div v-if="currentMeasurement.secondaryValue" class="text-caption text-medium-emphasis mb-2 px-1">
              {{ currentMeasurement.secondaryValue }}
            </div>

            <v-divider class="my-2"></v-divider>

            <!-- Detalles desglosados (deltas, centros, etc) con copiado por fila -->
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
                    {{ copiedTarget === 'detail-' + idx ? '¡Copiado!' : 'Copiar ' + detail.label }}
                  </v-tooltip>
                </v-btn>
              </div>
            </div>
          </div>

          <!-- Acciones Nueva Medición / Copiar / Borrar -->
          <div class="d-flex align-center ga-2 mt-2">
            <v-btn
              size="small"
              variant="flat"
              color="primary"
              prepend-icon="mdi-plus"
              class="flex-grow-1 text-none font-weight-bold"
              @click="commitAndNewMeasurement"
            >
              Fijar y Medir Otra
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
              {{ copiedTarget === 'all' ? '¡Copiado!' : 'Copiar' }}
              <v-tooltip activator="parent" location="top">Copiar informe completo</v-tooltip>
            </v-btn>
            <v-btn
              size="small"
              variant="outlined"
              color="error"
              prepend-icon="mdi-trash-can-outline"
              class="text-none font-weight-medium"
              @click="clearAllMeasurements"
            >
              Borrar
              <v-tooltip activator="parent" location="top">Borrar todas las cotas en pantalla</v-tooltip>
            </v-btn>
          </div>

          <!-- Opciones de persistencia de cotas -->
          <div class="mt-3 pt-2" style="border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);">
            <div class="d-flex align-center justify-space-between">
              <span class="text-caption font-weight-medium">Mantener cotas al cerrar panel</span>
              <v-switch
                v-model="keepMeasurementsOnExit"
                density="compact"
                color="primary"
                hide-details
                @update:model-value="toggleKeepMeasurements"
              />
            </div>
          </div>

          <!-- Lista de cotas fijadas en pantalla -->
          <div v-if="savedMeasurements && savedMeasurements.length > 0" class="mt-2">
            <div class="d-flex justify-space-between align-center mb-1">
              <span class="text-caption font-weight-bold text-medium-emphasis">
                COTAS EN PANTALLA ({{ savedMeasurements.length }})
              </span>
              <v-btn
                variant="text"
                size="x-small"
                color="error"
                class="px-1 text-caption"
                @click="clearAllMeasurements"
              >
                Limpiar todas
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
                    title="Eliminar esta cota"
                  >
                    <v-icon size="14">mdi-close</v-icon>
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
          </div>
        </v-card-text>
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
            <!-- Aislar / Salir de aislar -->
            <v-list-item
              :prepend-icon="contextMenu.isIsolated ? 'mdi-eye-off-outline' : 'mdi-select-compare'"
              :title="contextMenu.isIsolated ? 'Salir de aislar' : 'Aislar pieza'"
              @click="contextMenu.isIsolated ? restoreIsolation() : isolatePart(contextMenu.modelObject)"
            />

            <!-- Ocultar / Mostrar -->
            <v-list-item
              :prepend-icon="contextMenu.isVisible ? 'mdi-eye-off' : 'mdi-eye'"
              :title="contextMenu.isVisible ? 'Ocultar pieza' : 'Mostrar pieza'"
              @click="togglePartVisibility(contextMenu.modelObject)"
            />

            <!-- Enfocar pieza en la vista -->
            <v-list-item
              prepend-icon="mdi-crosshairs-gps"
              title="Enfocar en la vista"
              @click="zoomToPart(contextMenu.modelObject)"
            />
          </v-list>

          <v-divider />

          <!-- Opacidad / Transparencia Rápida -->
          <div class="px-3 py-2">
            <div class="text-caption text-medium-emphasis mb-1 d-flex align-center justify-space-between">
              <span class="d-flex align-center">
                <v-icon size="small" class="mr-1">mdi-opacity</v-icon> Opacidad
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
            <!-- Propiedades e Información -->
            <v-list-item
              prepend-icon="mdi-information-outline"
              title="Propiedades CAD"
              @click="openPartInfo(contextMenu.modelObject)"
            />

            <!-- Copiar Nombre -->
            <v-list-item
              prepend-icon="mdi-content-copy"
              title="Copiar nombre"
              @click="copyPartName(contextMenu.modelObject)"
            />
          </v-list>
        </template>

        <!-- If clicked in empty space (Canvas background) -->
        <template v-else>
          <div class="px-3 pt-3 pb-2 d-flex align-center justify-space-between">
            <div class="d-flex align-center">
              <v-icon color="primary" class="mr-2">mdi-axis-arrow</v-icon>
              <span class="text-subtitle-2 font-weight-bold">Espacio de trabajo 3D</span>
            </div>
            <v-btn icon="mdi-close" variant="text" size="x-small" @click="contextMenu.show = false" />
          </div>

          <v-divider />

          <v-list density="compact" class="py-1 bg-transparent">
            <v-list-item
              prepend-icon="mdi-eye"
              title="Mostrar todas las piezas"
              @click="showAllParts"
            />

            <v-list-item
              prepend-icon="mdi-opacity"
              title="Restablecer opacidades (100%)"
              @click="resetAllOpacities"
            />

            <v-list-item
              v-if="contextMenu.hasIsolatedActive"
              prepend-icon="mdi-eye-check-outline"
              title="Salir de aislamiento"
              @click="restoreIsolation"
            />

            <v-list-item
              prepend-icon="mdi-fit-to-screen-outline"
              title="Enfocar todo el modelo"
              @click="fitModelToScreen"
            />

            <v-list-item
              prepend-icon="mdi-select-off"
              title="Deseleccionar todo"
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
          <!-- Dimensiones Bounding Box -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-2">DIMENSIONES (BOUNDING BOX)</div>
          <v-row dense class="mb-3">
            <v-col cols="4">
              <v-card variant="tonal" class="pa-2 text-center" rounded="md">
                <div class="text-caption text-medium-emphasis">Longitud X</div>
                <div class="text-body-2 font-weight-bold font-monospace text-primary">{{ selectedPartProps.sizeX.toFixed(2) }} mm</div>
              </v-card>
            </v-col>
            <v-col cols="4">
              <v-card variant="tonal" class="pa-2 text-center" rounded="md">
                <div class="text-caption text-medium-emphasis">Ancho Y</div>
                <div class="text-body-2 font-weight-bold font-monospace text-primary">{{ selectedPartProps.sizeY.toFixed(2) }} mm</div>
              </v-card>
            </v-col>
            <v-col cols="4">
              <v-card variant="tonal" class="pa-2 text-center" rounded="md">
                <div class="text-caption text-medium-emphasis">Altura Z</div>
                <div class="text-body-2 font-weight-bold font-monospace text-primary">{{ selectedPartProps.sizeZ.toFixed(2) }} mm</div>
              </v-card>
            </v-col>
          </v-row>

          <!-- Centro Geométrico -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">CENTRO GEOMÉTRICO (X, Y, Z)</div>
          <v-sheet rounded="md" class="pa-2 mb-3 font-monospace text-caption" style="background-color: rgba(var(--v-theme-on-surface), 0.04); border: 1px solid rgba(var(--v-theme-on-surface), 0.08);">
            [{{ selectedPartProps.centerX.toFixed(2)}}, {{ selectedPartProps.centerY.toFixed(2)}}, {{ selectedPartProps.centerZ.toFixed(2)}}] mm
          </v-sheet>

          <!-- Topología de Malla -->
          <div class="text-caption font-weight-bold text-medium-emphasis mb-1">DETALLES DE MALLA CAD</div>
          <v-table density="compact" class="mb-3 text-body-2" style="background: transparent;">
            <tbody>
              <tr>
                <td class="text-medium-emphasis">Triángulos / Caras</td>
                <td class="text-right font-weight-bold font-monospace">{{ selectedPartProps.triangleCount.toLocaleString() }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Vértices</td>
                <td class="text-right font-weight-bold font-monospace">{{ selectedPartProps.vertexCount.toLocaleString() }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Submallas</td>
                <td class="text-right font-weight-bold font-monospace">{{ selectedPartProps.meshCount }}</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Volumen Caja Envolvente</td>
                <td class="text-right font-weight-bold font-monospace">{{ ((selectedPartProps.sizeX * selectedPartProps.sizeY * selectedPartProps.sizeZ) / 1000).toFixed(2) }} cm³</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Visibilidad</td>
                <td class="text-right font-weight-bold font-monospace">
                  <v-chip size="x-small" :color="selectedPartProps.visible ? 'success' : 'warning'" variant="tonal">
                    {{ selectedPartProps.visible ? 'Visible' : 'Oculto' }}
                  </v-chip>
                </td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Opacidad Actual</td>
                <td class="text-right font-weight-bold font-monospace">{{ Math.round(selectedPartProps.opacity * 100) }}%</td>
              </tr>
              <tr>
                <td class="text-medium-emphasis">Color Base</td>
                <td class="text-right d-flex align-center justify-end font-monospace">
                  <span :style="{ display: 'inline-block', width: '14px', height: '14px', backgroundColor: selectedPartProps.colorHex, borderRadius: '3px', marginRight: '6px', border: '1px solid rgba(0,0,0,0.2)' }"></span>
                  {{ selectedPartProps.colorHex }}
                </td>
              </tr>
            </tbody>
          </v-table>

          <!-- Propiedades Paramétricas FreeCAD (si existen) -->
          <div v-if="selectedPartProps.fcProperties && selectedPartProps.fcProperties.length > 0">
            <div class="text-caption font-weight-bold text-medium-emphasis mb-1">PROPIEDADES FREECAD</div>
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
            Copiar información
          </v-btn>
          <v-btn
            variant="tonal"
            size="small"
            @click="partPropertiesDialog = false"
          >
            Cerrar
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
  }),
  computed: {
    viewport3d: vm => vm.$refs.modelViewer,
    viewerWidth: (vm) => vm.fullScreen ? window.innerWidth : window.innerWidth - 64,
    viewerHeight: (vm) => vm.fullScreen ? window.innerHeight : window.innerHeight - 64,
    isDark() {
      return this.$vuetify?.theme?.global?.name === 'dark' || !!(this.$vuetify?.theme?.current?.dark);
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
    window.addEventListener('keydown', this.handleKeyDown);
  },
  beforeUnmount() {
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.viewer && typeof this.viewer.destroy === 'function') {
      this.viewer.destroy();
    }
  },
  created() {
  },
  methods: {
    handleKeyDown(e) {
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
      this.viewer.onSectionChangeCallback = ({ offset }) => {
        this.sectionOffset = Number(offset.toFixed(2));
      };
      if (typeof this.viewer.setDarkTheme === 'function') {
        this.viewer.setDarkTheme(this.isDark);
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
        this.$emit('section:changed', true);
        this.updateBounds();
        this.applySection();
      } else {
        this.sectionPanelOpen = !this.sectionPanelOpen;
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

    toggleMeasurement() {
      if (!this.measureActive) {
        this.measureActive = true;
        this.measurePanelOpen = true;
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
      if (event.button !== undefined && event.button !== 0) return;
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

    getSelectionPrompt() {
      if (this.firstSelectionSnap) {
        return 'Selecciona el segundo elemento (punto, arista, cara o orificio)...';
      }
      if (this.measureMode === 'planes') {
        return 'Haz clic en la primera cara plana...';
      }
      if (this.measureMode === 'lines') {
        return 'Haz clic en la primera arista o línea recta...';
      }
      if (this.measureMode === 'radius') {
        return 'Haz clic en un orificio, cilindro o arista curva...';
      }
      if (this.measureMode === 'distance') {
        return 'Haz clic en el primer punto o vértice...';
      }
      return 'Haz clic en cualquier cara, arista, orificio o punto...';
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
        this.snackbarText = `Copiado: ${text}`;
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
        `=== Medición CAD: ${m.title} ===`,
        `Resultado Principal: ${m.primaryValue}`
      ];
      if (m.secondaryValue) {
        lines.push(`Información Secundaria: ${m.secondaryValue}`);
      }
      if (m.details && m.details.length > 0) {
        lines.push(`Detalles Técnicos:`);
        m.details.forEach(d => {
          lines.push(`  • ${d.label}: ${d.value}`);
        });
      }
      const text = lines.join('\n');
      const ok = await this.copyToClipboard(text);
      if (ok) {
        this.copiedTarget = 'all';
        this.snackbarText = '¡Informe completo de medición copiado al portapapeles!';
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
        this.contextMenu.targetName = modelObject.name || 'Pieza CAD';
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
      this.showSnackbar(`Pieza aislada: ${modelObject.name || 'CAD'}`);
    },

    restoreIsolation() {
      if (!this.viewer) return;
      this.viewer.restoreIsolation();
      this.contextMenu.show = false;
      this.showSnackbar('Aislamiento cancelado. Mostrando todas las piezas.');
    },

    hidePart(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.hideObject(modelObject);
      this.contextMenu.show = false;
      this.showSnackbar(`Pieza oculta: ${modelObject.name || 'CAD'}`);
    },

    showPart(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.showObject(modelObject);
      this.contextMenu.show = false;
      this.showSnackbar(`Pieza visible: ${modelObject.name || 'CAD'}`);
    },

    togglePartVisibility(modelObject) {
      if (!this.viewer || !modelObject) return;
      this.viewer.toggleObjectVisibility(modelObject);
      const isVisible = modelObject.GetVisibility ? modelObject.GetVisibility() : true;
      this.contextMenu.show = false;
      this.showSnackbar(isVisible ? `Pieza visible: ${modelObject.name || 'CAD'}` : `Pieza oculta: ${modelObject.name || 'CAD'}`);
    },

    showAllParts() {
      if (!this.viewer) return;
      this.viewer.showAllObjects();
      this.contextMenu.show = false;
      this.showSnackbar('Todas las piezas están visibles');
    },

    setPartOpacity(modelObject, opacity) {
      if (!this.viewer || !modelObject) return;
      this.viewer.setObjectOpacity(modelObject, opacity);
      this.contextMenu.currentOpacity = opacity;
      this.showSnackbar(`Opacidad de "${modelObject.name || 'pieza'}" ajustada al ${Math.round(opacity * 100)}%`);
    },

    resetAllOpacities() {
      if (!this.viewer) return;
      this.viewer.resetAllOpacities();
      this.contextMenu.show = false;
      this.showSnackbar('Todas las opacidades restablecidas al 100%');
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
      this.showSnackbar(`Nombre copiado: "${name}"`);
    },

    copyAllProperties(props) {
      if (!props) return;
      const lines = [
        `=== PROPIEDADES CAD ===`,
        `Nombre: ${props.name}`,
        props.realName ? `Nombre Real: ${props.realName}` : null,
        `Tipo: ${props.type}`,
        `UUID: ${props.uuid}`,
        `--- DIMENSIONES ---`,
        `Longitud X: ${props.sizeX.toFixed(2)} mm`,
        `Ancho Y: ${props.sizeY.toFixed(2)} mm`,
        `Altura Z: ${props.sizeZ.toFixed(2)} mm`,
        `Volumen Caja: ${((props.sizeX * props.sizeY * props.sizeZ) / 1000).toFixed(2)} cm³`,
        `Centro: [${props.centerX.toFixed(2)}, ${props.centerY.toFixed(2)}, ${props.centerZ.toFixed(2)}] mm`,
        `--- TOPOLOGÍA ---`,
        `Triángulos: ${props.triangleCount.toLocaleString()}`,
        `Vértices: ${props.vertexCount.toLocaleString()}`,
        `Submallas: ${props.meshCount}`,
        `Visibilidad: ${props.visible ? 'Visible' : 'Oculto'}`,
        `Opacidad: ${Math.round(props.opacity * 100)}%`,
        `Color Hex: ${props.colorHex}`
      ].filter(Boolean);

      if (props.fcProperties && props.fcProperties.length > 0) {
        lines.push('--- PROPIEDADES FREECAD ---');
        props.fcProperties.forEach(p => lines.push(`${p.name}: ${p.value}`));
      }

      navigator.clipboard.writeText(lines.join('\n'));
      this.showSnackbar('Todas las propiedades copiadas al portapapeles');
    },

  }
}
</script>

<style scoped>
.measurement-detail-row:hover {
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
}
.measurement-badges-container {
  pointer-events: none;
}
</style>
