import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

/**
 * The blue/grey/slate shop-floor theme, in both schemes.
 *
 * Light is what ships. Adding `class="app-dark"` to `<html>` switches PrimeNG
 * to the dark scheme below and, because the same class drives the app's own
 * tokens in `styles/base/_tokens.scss`, the components and the page chrome move
 * together. Red is held back for danger states and for the scrap grade, which
 * keeps it meaningful on screen.
 *
 * The `gray` ramp must stay ordered light-to-dark. Both schemes read the same
 * ramp from opposite ends — light takes `surface.0` as the page and `900` as
 * its text, dark the other way about — so an inverted ramp turns dialogs white
 * and input text invisible.
 *
 * This deliberately overrides Aura's own `blue`, `gray` and `slate`
 * primitives: one set of each in the app, matching `base/_tokens.scss`
 * exactly. `red` / `amber` / `green` / `cyan` are left as Aura ships them.
 */
export const WasteLogPreset = definePreset(Aura, {
  primitive: {
    blue: {
      50: '#eff6ff',
      100: '#dbeafe',
      200: '#bfdbfe',
      300: '#93c5fd',
      400: '#60a5fa',
      500: '#3b82f6',
      600: '#2563eb',
      700: '#1d4ed8',
      800: '#1e40af',
      900: '#1e3a8a',
      950: '#172554',
    },
    // Read from either end: the light scheme takes 0 as its page and 900 as
    // its text, the dark scheme the other way about. 750/850 exist for the
    // dim (dark) theme; Aura has no such keys, so the surface map below
    // shifts the last two onto them.
    gray: {
      0: '#ffffff',
      50: '#f7f8fa',
      100: '#f0f2f5',
      200: '#e3e6eb',
      300: '#d0d5dd',
      400: '#a3abb6',
      500: '#7c8491',
      600: '#58616d',
      700: '#3f4753',
      750: '#2f3540',
      800: '#262c35',
      850: '#1d222a',
      900: '#161a21',
    },
    slate: {
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      550: '#55657a',
      600: '#475569',
      700: '#334155',
    },
  },

  semantic: {
    primary: {
      50: '{blue.50}',
      100: '{blue.100}',
      200: '{blue.200}',
      300: '{blue.300}',
      400: '{blue.400}',
      500: '{blue.500}',
      600: '{blue.600}',
      700: '{blue.700}',
      800: '{blue.800}',
      900: '{blue.900}',
      950: '{blue.950}',
    },

    focusRing: {
      width: '2px',
      style: 'solid',
      color: '{blue.500}',
      offset: '2px',
    },

    formField: {
      paddingX: '1.2rem',
      paddingY: '0.8rem',
      borderRadius: '6px',

      sm: {
        fontSize: '1.3rem',
        paddingX: '1rem',
        paddingY: '0.6rem',
      },

      // The large variant the account screens wear. Target heights are 4.0rem
      // default and 4.8rem large.
      lg: {
        fontSize: '1.6rem',
        paddingX: '1.4rem',
        paddingY: '1.1rem',
      },
    },

    colorScheme: {
      light: {
        primary: {
          color: '{blue.600}',
          contrastColor: '#ffffff',
          hoverColor: '{blue.700}',
          activeColor: '{blue.800}',
        },
        highlight: {
          background: 'rgba(37, 99, 235, 0.08)',
          focusBackground: 'rgba(37, 99, 235, 0.14)',
          color: '{blue.800}',
          focusColor: '{blue.900}',
        },
        surface: {
          0: '{gray.0}',
          50: '{gray.50}',
          100: '{gray.100}',
          200: '{gray.200}',
          300: '{gray.300}',
          400: '{gray.400}',
          500: '{gray.500}',
          600: '{gray.600}',
          700: '{gray.700}',
          800: '{gray.800}',
          900: '{gray.850}',
          950: '{gray.900}',
        },
      },

      dark: {
        primary: {
          color: '{blue.400}',
          contrastColor: '{gray.900}',
          hoverColor: '{blue.300}',
          activeColor: '{blue.200}',
        },
        highlight: {
          background: 'rgba(96, 165, 250, 0.14)',
          focusBackground: 'rgba(96, 165, 250, 0.22)',
          color: '#ffffff',
          focusColor: '#ffffff',
        },
        surface: {
          0: '{gray.0}',
          50: '{gray.50}',
          100: '{gray.100}',
          200: '{gray.200}',
          300: '{gray.300}',
          400: '{gray.400}',
          500: '{gray.500}',
          600: '{gray.600}',
          700: '{gray.700}',
          800: '{gray.800}',
          900: '{gray.850}',
          950: '{gray.900}',
        },
      },
    },
  },

  components: {
    button: {
      root: {
        borderRadius: '6px',
        paddingX: '1.6rem',
        paddingY: '0.8rem',
        gap: '0.8rem',
        label: { fontWeight: '600' },
        sm: {
          fontSize: '1.3rem',
          paddingX: '1.2rem',
          paddingY: '0.6rem',
        },
        lg: {
          fontSize: '1.6rem',
          paddingX: '2rem',
          paddingY: '1.1rem',
        },
      },
      colorScheme: {
        light: {
          root: {
            // Solid blue, matching the first grade's tap button on the waste
            // screen — the same fill in either scheme, so the primary action
            // looks like itself whichever theme is on.
            primary: {
              background: '{blue.600}',
              hoverBackground: '{blue.700}',
              activeBackground: '{blue.800}',
              borderColor: '{blue.600}',
              hoverBorderColor: '{blue.700}',
              activeBorderColor: '{blue.800}',
              color: '#ffffff',
              hoverColor: '#ffffff',
              activeColor: '#ffffff',
              focusRing: { color: '{blue.500}' },
            },
          },
          // Row-action buttons sit on a white table; the stock text colours are
          // too pale to find at a glance.
          text: {
            secondary: {
              color: '{gray.600}',
              hoverBackground: '{gray.100}',
              activeBackground: '{gray.200}',
            },
            danger: {
              color: '{red.600}',
              hoverBackground: 'rgba(220, 38, 38, 0.08)',
              activeBackground: 'rgba(220, 38, 38, 0.14)',
            },
          },
        },
        dark: {
          root: {
            primary: {
              background: '{blue.600}',
              hoverBackground: '{blue.700}',
              activeBackground: '{blue.800}',
              borderColor: '{blue.600}',
              hoverBorderColor: '{blue.700}',
              activeBorderColor: '{blue.800}',
              color: '#ffffff',
              hoverColor: '#ffffff',
              activeColor: '#ffffff',
              focusRing: { color: '{blue.500}' },
            },
          },
          // Row-action buttons sit on a dark table; the stock text colours are
          // too dim to find at a glance.
          text: {
            secondary: {
              color: '{gray.300}',
              hoverBackground: '{gray.750}',
              activeBackground: '{gray.700}',
            },
            danger: {
              color: '{red.400}',
              hoverBackground: 'rgba(248, 113, 113, 0.14)',
              activeBackground: 'rgba(248, 113, 113, 0.2)',
            },
          },
        },
      },
    },

    // A light header, not a band — the medium slate chrome belongs to the
    // register grids (`$band*`), not to PrimeNG data tables.
    datatable: {
      colorScheme: {
        light: {
          header: { background: '{gray.50}' },
          headerCell: {
            background: '{gray.50}',
            color: '{gray.600}',
            borderColor: '{gray.200}',
            padding: '1rem 1.6rem',
          },
          columnTitle: { fontWeight: '600' },
          bodyCell: {
            padding: '1.2rem 1.6rem',
            borderColor: '{gray.200}',
          },
          row: { hoverBackground: '{gray.50}' },
          footerCell: {
            background: '{gray.50}',
            borderColor: '{gray.200}',
          },
        },
        dark: {
          header: { background: '{gray.750}' },
          headerCell: {
            background: '{gray.750}',
            color: '{gray.400}',
            borderColor: '{gray.700}',
            padding: '1rem 1.6rem',
          },
          columnTitle: { fontWeight: '600' },
          bodyCell: {
            padding: '1.2rem 1.6rem',
            borderColor: '{gray.750}',
          },
          row: {
            background: '{gray.800}',
            hoverBackground: '{gray.750}',
          },
          footerCell: {
            background: '{gray.750}',
            borderColor: '{gray.700}',
          },
        },
      },
    },

    dialog: {
      root: { borderRadius: '12px' },
      header: { padding: '2rem 2.4rem 1.2rem' },
      title: { fontSize: '1.8rem', fontWeight: '600' },
      content: { padding: '0 2.4rem 2rem' },
      footer: { padding: '0 2.4rem 2rem', gap: '0.8rem' },
    },

    toast: {
      root: {
        borderWidth: '0 0 0 4px',
        borderRadius: '8px',
      },
    },

    tooltip: {
      root: {
        background: '{slate.700}',
        color: '#ffffff',
        padding: '0.6rem 1rem',
        borderRadius: '6px',
      },
    },

    tag: {
      root: {
        fontSize: '1.2rem',
        fontWeight: '600',
        padding: '0.2rem 0.8rem',
        borderRadius: '4px',
      },
    },

    tabs: {
      tab: {
        padding: '1.2rem 1.6rem',
        fontWeight: '500',
      },
      activeBar: { background: '{blue.600}' },
    },

    skeleton: {
      colorScheme: {
        light: { root: { background: '{gray.200}' } },
      },
    },
  },
});
