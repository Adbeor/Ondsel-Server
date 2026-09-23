<!--
SPDX-FileCopyrightText: 2024 Ondsel <development@ondsel.com>

SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
  <v-treeview
    v-if="model3d"
    :items="treeViewItems"
    item-props
    slim
    selectable
    activatable
    open-on-click
    height="90%"
    density="compact"
    select-strategy="single-independent"
    style="position: absolute; top: 70px; background: transparent;"
  >
    <template v-slot:prepend="{ item, open }">
      <v-checkbox v-model="selectedObjects[item.uuid]" density="compact" hide-details @click.stop="objectSelected(item)"/>
      <v-btn
        :icon="isItemVisible(item) ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
        :color="isItemVisible(item) ? undefined : 'grey'"
        :title="isItemVisible(item) ? 'Ocultar pieza (Espacio)' : 'Mostrar pieza (Espacio)'"
        variant="text"
        flat
        @click.stop="toggleVisibility(item)"
      />
    </template>
    <template v-slot:title="{ item }">
      <span
        class="cursor-pointer select-none"
        :class="{ 'text-disabled': !isItemVisible(item) }"
        @click.stop="objectSelected(item)"
      >
        {{ item.title || (item.raw && item.raw.title) }}
      </span>
    </template>
    <template v-slot:append="{ item, open }">
      <v-btn
        v-if="linkedObjects.hasOwnProperty(item.realName)"
        icon="mdi-open-in-new"
        variant="text"
        @click.stop="openAssemblyObjectInfoDialog(item.realName)"
      />
    </template>
  </v-treeview>
  <AssemblyObjectInfoDialog ref="assemblyObjectInfoDialog" />
</template>

<script>
import AssemblyObjectInfoDialog from '@/components/AssemblyObjectInfoDialog.vue';

export default {
  name: "ObjectsListView",
  emits: ['selectGivenObject'],
  components: {AssemblyObjectInfoDialog},
  props: {
    model: {
      type: Object,
      required: false,
    }
  },
  data: () => ({
    viewer: null,
    open: ['Objects'],
    active: [],
    selectedObjsUuid: [],
    visibilityMap: {},
    visibilityVersion: 0,
  }),
  watch: {
    viewer: {
      immediate: true,
      handler(newViewer) {
        if (newViewer && newViewer.onVisibilityChange) {
          if (this._unsubVisibility) this._unsubVisibility();
          this._unsubVisibility = newViewer.onVisibilityChange(() => {
            this.syncVisibilityMap();
          });
          this.syncVisibilityMap();
        }
      }
    },
    model3d: {
      immediate: true,
      handler(newModel) {
        if (newModel) {
          this.$nextTick(() => this.syncVisibilityMap());
        }
      }
    }
  },
  beforeUnmount() {
    if (this._unsubVisibility) {
      this._unsubVisibility();
      this._unsubVisibility = null;
    }
  },
  computed: {
    model3d: vm => vm.viewer ? vm.viewer.model : null,
    objects3d: vm => vm.viewer ? vm.viewer.model.objects3d : null,
    linkedObjects: vm => vm.viewer ? vm.viewer.importer.activeImporter?.document?.LinkedFiles() || {} : {},
    treeViewItems() {
      const self = this;
      function convertToTitleObject(modelObject) {
        let isVis = self.visibilityMap[modelObject.uuid];
        if (isVis === undefined) {
          isVis = modelObject.GetVisibility ? modelObject.GetVisibility() : true;
        }
        let result = {
          id: modelObject.uuid,
          title: modelObject.GetLabel(),
          uuid: modelObject.uuid,
          visibility: isVis,
          realName: modelObject.GetRealName(),
        };

        if (modelObject.children && modelObject.children.length > 0) {
          result.children = modelObject.children.map(child => convertToTitleObject(child));
        }

        return result;
      }
      return this.model3d ? this.model3d.GetRootObjects().map(root => convertToTitleObject(root)) : [];
    },
    selectedObjects() {
      const data = {};
      if (this.model3d) {
        this.model3d.GetObjects().forEach(o => {
          data[o.uuid] = this.selectedObjsUuid.some(uuid => uuid === o.uuid);
        })
      }
      return data;
    },
    activated() {
      return this.model3d ? this.model3d.GetRootObjects().map(m => m.uuid) : [];
    }
  },
  methods: {
    setViewer(viewer) {
      this.viewer = viewer;
      if (viewer && viewer.onVisibilityChange) {
        if (this._unsubVisibility) this._unsubVisibility();
        this._unsubVisibility = viewer.onVisibilityChange(() => {
          this.syncVisibilityMap();
        });
        this.syncVisibilityMap();
      }
    },
    syncVisibilityMap() {
      if (!this.model3d) return;
      const map = {};
      const allObjs = this.model3d.GetObjects ? this.model3d.GetObjects() : [];
      for (const obj of allObjs) {
        map[obj.uuid] = obj.GetVisibility ? obj.GetVisibility() : true;
      }
      this.visibilityMap = map;
      this.visibilityVersion++;
    },
    isItemVisible(item) {
      if (!item) return true;
      const uuid = item.uuid || (item.raw && item.raw.uuid);
      if (!uuid) return true;
      const _ver = this.visibilityVersion;
      if (this.visibilityMap && this.visibilityMap[uuid] !== undefined) {
        return this.visibilityMap[uuid];
      }
      if (this.model3d) {
        const obj = this.model3d.findObjectByUuid(uuid);
        if (obj && obj.GetVisibility) {
          return obj.GetVisibility();
        }
      }
      return item.visibility !== undefined ? item.visibility : true;
    },
    objectSelected(item) {
      const uuid = item.uuid || (item.raw && item.raw.uuid);
      if (!uuid || !this.model3d) return;
      const object3d = this.model3d.findObjectByUuid(uuid);
      if (!object3d) return;
      const isObjSelected = this.selectedObjects[uuid];

      for (let obj of [object3d, ...object3d.GetAllChildren()]) {
        if (isObjSelected === this.selectedObjects[obj.uuid]) {
          this.viewer.selectGivenObject(obj);
          if (this.viewer.selectedObjs.some(selectedObj => selectedObj.uuid === obj.uuid)) {
            this.selectedObjsUuid.push(obj.uuid);
          } else {
            const index = this.selectedObjsUuid.indexOf(obj.uuid);
            if (index > -1) {
              this.selectedObjsUuid.splice(index, 1);
            }
          }
        }
      }
    },
    selectListItem(object3d) {
      const index = this.selectedObjsUuid.indexOf(object3d.uuid);
      if (index > -1) {
        this.selectedObjsUuid.splice(index, 1);
      } else {
        this.selectedObjsUuid.push(object3d.uuid);
      }
    },
    openAssemblyObjectInfoDialog(objectName) {
      if (this.model && this.linkedObjects.hasOwnProperty(objectName)) {
        this.$refs.assemblyObjectInfoDialog.openDialog(this.model.file.directory._id, this.linkedObjects[objectName]);
      }
    },
    toggleVisibility(item) {
      const uuid = item.uuid || (item.raw && item.raw.uuid);
      if (!uuid || !this.model3d) return;
      const object3d = this.model3d.findObjectByUuid(uuid);
      if (!object3d) return;

      if (this.viewer && this.viewer.toggleObjectVisibility) {
        this.viewer.toggleObjectVisibility(object3d);
      } else {
        object3d.ToggleVisibility();
        if (this.viewer && this.viewer.notifyVisibilityChange) {
          this.viewer.notifyVisibilityChange(object3d);
        }
      }
      this.syncVisibilityMap();
    },
  }
}

</script>

<style scoped>

</style>
