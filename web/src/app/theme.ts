import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

/**
 * The navy shop-floor theme, in both schemes.
 *
 * Light is what ships. Adding `class="app-dark"` to `<html>` switches PrimeNG
 * to the dark scheme below and, because the same class drives the app's own
 * tokens in `styles/base/_tokens.scss`, the components and the page chrome move
 * together. Red is held back for danger states and for the scrap grade, which
 * keeps it meaningful on screen.
 *
 * The `ink` ramp must stay ordered light-to-dark. Both schemes read the same
 * ramp from opposite ends — light takes `surface.0` as the page and `950` as
 * its text, dark the other way about — so an inverted ramp turns dialogs white
 * and input text invisible.
 */
export const WasteLogPreset = definePreset(Aura, {
  primitive: {
    navy: {
      50: '#eef3fa',
      100: '#d3e0f0',
      200: '#a8c0e0',
      300: '#7098cb',
      400: '#3f6fa8',
      500: '#1e4e86',
      600: '#173d6b',
      700: '#122e52',
      800: '#0e2440',
      900: '#0a1a2f',
      950: '#060f1c',
    },
    // Read from either end: the light scheme takes 0 as its page and 950 as
    // its text, the dark scheme the other way about.
    ink: {
      0: '#ffffff',
      50: '#f5f7fa',
      100: '#eef1f6',
      200: '#dbe4f1',
      300: '#bccce2',
      400: '#8296ae',
      500: '#62758f',
      600: '#475569',
      700: '#1e3556',
      800: '#10203a',
      900: '#0b1524',
      950: '#05090f',
    },
  },

  semantic: {
    primary: {
      50: '{navy.50}',
      100: '{navy.100}',
      200: '{navy.200}',
      300: '{navy.300}',
      400: '{navy.400}',
      500: '{navy.500}',
      600: '{navy.600}',
      700: '{navy.700}',
      800: '{navy.800}',
      900: '{navy.900}',
      950: '{navy.950}',
    },

    formField: {
      paddingX: '0.9rem',
      paddingY: '0.65rem',
      borderRadius: '6px',
    },

    colorScheme: {
      light: {
        // Deep enough to carry white text on a button and to read as a link
        // against the near-white page.
        primary: {
          color: '{navy.500}',
          contrastColor: '#ffffff',
          hoverColor: '{navy.600}',
          activeColor: '{navy.700}',
        },
        highlight: {
          background: 'rgba(30, 78, 134, 0.10)',
          focusBackground: 'rgba(30, 78, 134, 0.18)',
          color: '{navy.700}',
          focusColor: '{navy.800}',
        },
        surface: {
          0: '{ink.0}',
          50: '{ink.50}',
          100: '{ink.100}',
          200: '{ink.200}',
          300: '{ink.300}',
          400: '{ink.400}',
          500: '{ink.500}',
          600: '{ink.600}',
          700: '{ink.700}',
          800: '{ink.800}',
          900: '{ink.900}',
          950: '{ink.950}',
        },
      },

      dark: {
        // Light enough to carry text, icons and focus rings on the near-black
        // page; buttons get a solid navy fill of their own further down.
        primary: {
          color: '{navy.300}',
          contrastColor: '{ink.950}',
          hoverColor: '{navy.200}',
          activeColor: '{navy.100}',
        },
        highlight: {
          background: 'rgba(112, 152, 203, 0.18)',
          focusBackground: 'rgba(112, 152, 203, 0.28)',
          color: '#ffffff',
          focusColor: '#ffffff',
        },
        surface: {
          0: '{ink.0}',
          50: '{ink.50}',
          100: '{ink.100}',
          200: '{ink.200}',
          300: '{ink.300}',
          400: '{ink.400}',
          500: '{ink.500}',
          600: '{ink.600}',
          700: '{ink.700}',
          800: '{ink.800}',
          900: '{ink.900}',
          950: '{ink.950}',
        },
      },
    },
  },

  components: {
    button: {
      root: {
        borderRadius: '6px',
        paddingX: '1rem',
        paddingY: '0.55rem',
        label: { fontWeight: '600' },
      },
      colorScheme: {
        light: {
          root: {
            // Solid navy, matching the first grade's tap button on the waste
            // screen — the same fill in either scheme, so the primary action
            // looks like itself whichever theme is on.
            primary: {
              background: '{navy.500}',
              hoverBackground: '{navy.600}',
              activeBackground: '{navy.700}',
              borderColor: '{navy.500}',
              hoverBorderColor: '{navy.600}',
              activeBorderColor: '{navy.700}',
              color: '#ffffff',
              hoverColor: '#ffffff',
              activeColor: '#ffffff',
              focusRing: { color: '{navy.400}' },
            },
          },
          // Row-action buttons sit on a white table; the stock text colours are
          // too pale to find at a glance.
          text: {
            secondary: {
              color: '{ink.600}',
              hoverBackground: '{ink.100}',
              activeBackground: '{ink.200}',
            },
            danger: {
              color: '{red.600}',
              hoverBackground: 'rgba(224, 49, 49, 0.10)',
              activeBackground: 'rgba(224, 49, 49, 0.18)',
            },
          },
        },
        dark: {
          root: {
            // Solid navy, matching the first grade's tap button on the waste
            // screen.
            primary: {
              background: '{navy.500}',
              hoverBackground: '{navy.400}',
              activeBackground: '{navy.600}',
              borderColor: '{navy.400}',
              hoverBorderColor: '{navy.300}',
              activeBorderColor: '{navy.500}',
              color: '#ffffff',
              hoverColor: '#ffffff',
              activeColor: '#ffffff',
              focusRing: { color: '{navy.300}' },
            },
          },
          // Row-action buttons sit on a dark table; the stock text colours are
          // too dim to find at a glance.
          text: {
            secondary: {
              color: '{ink.300}',
              hoverBackground: '{ink.800}',
              activeBackground: '{ink.700}',
            },
            danger: {
              color: '{red.400}',
              hoverBackground: 'rgba(224, 49, 49, 0.16)',
              activeBackground: 'rgba(224, 49, 49, 0.24)',
            },
          },
        },
      },
    },
    datatable: {
      colorScheme: {
        // The header band keeps the brand navy in both schemes: it is what
        // makes a table read as the register it replaces rather than as a
        // spreadsheet.
        light: {
          header: { background: '{navy.800}' },
          headerCell: {
            background: '{navy.800}',
            color: '#ffffff',
            borderColor: '{navy.700}',
          },
          bodyCell: { borderColor: '{ink.200}' },
          footerCell: {
            background: '{ink.100}',
            borderColor: '{ink.200}',
          },
        },
        dark: {
          header: { background: '{navy.900}' },
          headerCell: {
            background: '{navy.900}',
            color: '#ffffff',
            borderColor: '{ink.700}',
          },
          bodyCell: { borderColor: '{ink.800}' },
          footerCell: {
            background: '{navy.900}',
            borderColor: '{ink.700}',
          },
        },
      },
    },
    dialog: {
      root: { borderRadius: '10px' },
      header: { padding: '1.4rem 1.6rem' },
      content: { padding: '0 1.6rem 0.4rem' },
    },
    toast: {
      root: { borderWidth: '0 0 0 5px' },
    },
  },
});
