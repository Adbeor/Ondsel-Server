// SPDX-FileCopyrightText: 2024 Ondsel <development@ondsel.com>
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css'
import '@/styles/main.scss'

// Composables
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components'
import * as labsComponents from 'vuetify/labs/components'

import { getThemePreference, resolveActiveTheme } from '@/themePreference'

const customLightTheme = {
  dark: false,
  colors: {
    primary: '#0D47A1',
    secondary: '#607D8B',
    decoration: '#9E9E9E',
    link: '#263238',
    error: '#B71C1C',
    cancel: '#9E9E9E',
    success: '#00C853',
    background: '#FAFAFA',
    surface: '#FFFFFF',
    // 'placeholder' = subtle background for empty thumbnails, etc.
    // 'muted' = de-emphasized text (icons over placeholders).
    // 'surface-soft' = slightly-tinted card section (e.g., v-card-title bg).
    placeholder: '#F4F4F4',
    muted: '#757575',
    'surface-soft': '#F5F5F7',
  },
};

const customDarkTheme = {
  dark: true,
  colors: {
    primary: '#5C9CE6',
    secondary: '#B0BEC5',
    decoration: '#757575',
    link: '#82B1FF',
    error: '#EF5350',
    cancel: '#BDBDBD',
    success: '#69F0AE',
    background: '#121212',
    surface: '#1E1E1E',
    'surface-variant': '#2A2A2A',
    placeholder: '#2C2C2C',
    muted: '#9E9E9E',
    'surface-soft': '#262626',
  },
};


// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: resolveActiveTheme(getThemePreference()),
    themes: {
      light: customLightTheme,
      dark: customDarkTheme,
    }
  },
  components: {
    ...components, ...labsComponents
  }
})
