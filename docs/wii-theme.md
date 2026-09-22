# Wii-inspired device UI

The camera's own screen (240×240 SPI display, 5-way switch) gets a UI inspired by the original Wii
Menu. It has three pages: **Camera**, **Pictures** and **Settings**. The website gets a **Device**
tab that runs the exact same UI code as WebAssembly, on an emulated display that decodes the real
SPI byte stream. You can build and test the device UI before the display is even wired up.

## 0. Design principles (first priority)

Clean, consistent UI comes before everything else in this theme, features included. Every screen
and every change is checked against these rules. They come from what Nintendo's designers say
about the Wii Menu (sources at the end):

| Nintendo, in their words | Rule here |
|---|---|
| "The three rows of four Channels are treated equally" | **Equal weight.** One shape and size per kind of element (tile, row, thumbnail, button). No element is dressed up to shout louder than its peers |
| "Lots of screens, lots of channels, all lined up. This is easy to understand" | **One simple model.** Every screen is the same frame: nav bar, content, bottom bar |
| "Wii is more about 'experiencing', rather than 'understanding'" | **No explanations on screen.** No hint rows, tips, captions or commentary. If a control needs a sentence to explain it, redesign the control |
| The Disc Channel is fixed top-left, settings are fixed bottom-left, and a channel opens with **Start** | **Fixed placement.** A control never moves between screens |
| "Fun for the entire family", so no one "feel[s] left out through not understanding" | **Nothing hidden.** No secret shortcuts. Everything the user can do is visible |

### The rules

1. **One frame.** Every screen has the nav bar on top (clock left, status icons right). Pages
   have the bottom bar below with **Back bottom-left** (and any primary action bottom-right), in
   the same size, shape and position on every page, like the Wii's *Wii Menu* / *Start* pair.
   Home has no Back; its bottom bar holds the page dots. The **Camera is the one full-screen app**:
   just the picture under the nav bar, like a camera's live view.
2. **One control model.** Arrows *only* move focus, spatially: through the content, then down into
   the bottom bar and back up. **Center and A activate** the focused element, and **B goes back**
   (Nintendo's A = OK, B = Back). There are no other bindings. The Camera app follows camera
   convention instead: **A takes a picture, B toggles the flash**, and Center is **MENU/OK**
   (back to Home), as on point-and-shoot cameras whose center button is MENU/OK.
3. **One focus style.** A 3 px accent outline on whatever has focus: tiles, rows, thumbnails and
   buttons alike. Unfocused elements get a 1 px `line` outline.
4. **Sensible first focus.** A page opens with its most likely action focused: the first row on
   Settings, the last-viewed photo on Pictures.
5. **Labels and state only.** On-screen text is limited to names, values and state (`1920x1080`,
   `Off`, `76%`, a file name). Never instructions or commentary. The same rule applies to the
   website (see `CLAUDE.md`).
6. **Calm visuals.** Soft grays, one accent color, lots of whitespace, the same corner radii, and
   the same easing for every motion.

These rules are enforced by tests (`make uitest`):
- `back_button_is_identical_on_every_page`: the same pixels in the same place.
- `arrows_never_change_settings_or_leave_pages`: no hidden bindings.
- `no_hint_text_on_home`: no instructional text.

## 1. Research: the original Wii Menu

What defines the look and feel, from the sources below:

| Element | Original Wii Menu | Notes |
|---|---|---|
| Structure | "Channels" (apps) as tiles in a **4×3 grid per page, 4 pages**, 48 slots | The Disc Channel is pinned top-left |
| Paging | Plus/minus buttons (or side arrows) **slide** the grid a full page horizontally | Smooth eased slide, no hard cut |
| Tiles | Glossy **rounded rectangles** with a thin light-gray border, on a white/light-gray lined background. Hovering makes the tile wiggle and grow slightly, with a blue outline. Empty slots are plain gray tiles | Animated previews inside tiles |
| Clock | Large gray digital clock and date, **centered in a curved bottom bar** | The bar also holds the round Wii button (left) and Message Board (right) |
| Palette | White and light grays, gray text, with the **Wii light blue** accent for focus and highlights | Low-contrast, soft, lots of whitespace |
| Type | Rodin NTLG, a rounded humanist sans | **Proprietary**, so we don't use it |
| Photos | Photo Channel: SD card thumbnails → full view, slideshow, simple edit modes | Our Pictures page maps to this |
| Settings | Wii Settings: paged lists of large, flat, rounded buttons | Our Settings page maps to this |

### Open-source web clones reviewed

| Project | Stack | License | Useful for | Caveat |
|---|---|---|---|---|
| [zuvv/WiiMenu](https://github.com/zuvv/WiiMenu) | React, TS, Vite, Canvas2D, Web Audio | not stated | Grid + page arrows, bottom bar with clock, hover wiggle, a shared "gloss" surface token | Ships original Nintendo audio. **Don't copy any assets** |
| [tobieche110/wii-portfolio](https://github.com/tobieche110/wii-portfolio) | React, Tailwind, GSAP | MIT | Tile grid + page transitions driven by GSAP easing | Portfolio layout, not a menu system |
| [andrewplus/Wii.JS](https://github.com/andrewplus/Wii.JS/), [danintosh/Wii-Menu-HTML](https://github.com/danintosh/Wii-Menu-HTML), [cornetespoir/wii-menu-page](https://github.com/cornetespoir/wii-menu-page) | HTML/CSS/JS | varies | Plain CSS recreations of tile gloss and borders | Hobby projects, mixed quality |
| [J3rr1ck/wiijs](https://github.com/J3rr1ck/wiijs) | JS | — | — | No working code yet |

**Takeaways:** every clone targets a mouse-driven desktop page, and none targets a tiny
button-driven display. So we borrow the *design language*: rounded tiles, soft grays, blue focus,
eased sliding, a clock in a bar. No code is reused, and the device UI is written from scratch in
portable C++.

### IP guardrails

This is *inspired by* the Wii, not a copy. No Nintendo logos, names in the UI, sounds, fonts,
images or channel art. The font is **M PLUS Rounded 1c** (SIL Open Font License), rendered to a
bitmap header. Its license is kept next to the generated file. The accent color is our own value,
close to the familiar light blue.

## 2. Design for a 240×240 display and a 5-way switch

The Wii's pointer and big TV don't fit here. What changes:

- **The clock moves to the top-left of a nav bar.** It goes where the user asked, and a nav bar
  suits a small square screen better than a curved bottom bar.
- **Top-right of the nav bar: the connection or battery icon.** It shows a **USB** icon while the
  site is connected over WebSerial, the **battery** level once the battery is wired and measured,
  and nothing otherwise.
- **Home is a row of small rounded squares, one per page** (Camera, Pictures, Settings), instead
  of a 4×3 grid. ← → moves focus. The row **slides with easing** to keep the focused tile centered,
  and the focused tile grows and gets the blue outline (the Wii hover). Page dots in the bottom bar
  show the position.
- **Center** (or A) opens the focused page. On every page, **Back** is the bottom-left button (B
  also goes back). The Pictures grid opens a photo in a **viewer**, whose only control is Back.
  Settings change with Center, which toggles or cycles the value, because arrows never change
  values. The settings are Resolution, Mirror, Flip vertical, **Grid** (rule-of-thirds overlay on
  the camera), **Clock** (24h, or 12h with AM/PM in the nav bar) and About. Five rows are visible,
  and the list scrolls to keep focus in view.
- **Camera:** a full-screen picture under the nav bar, with no buttons on screen. A takes a picture
  (a white blink), B toggles the flash, and Center returns to Home.
- **Flash:** a light ring *around* the physical display, outside the 240×240 panel. On the panel,
  a bolt icon sits in the status area to the left of the USB/battery icon. The emulator draws the
  ring as a 20-panel-pixel white frame around the display (`ui_flash()`).

### Palette (RGB888 → RGB565)

| Token | RGB888 | RGB565 | Use |
|---|---|---|---|
| `bg` | `#EEF0F2` | `0xEF9E` | page background |
| `bar` | `#F7F7F7` | `0xF7BE` | nav bar (exactly neutral in RGB565; `#FAFAFA` quantizes to a pink tint) |
| `line` | `#C9CDD2` | `0xCE7A` | nav bar divider, tile borders |
| `tile` | `#FFFFFF` | `0xFFFF` | tile face |
| `text` | `#707780` | `0x73B0` | clock, labels |
| `accent` | `#34BEED` | `0x35FD` | focus outline, active states |
| `ink` | `#3A4048` | `0x3A09` | titles, icons |

### Motion

- Focus changes ease over **200 ms** with ease-out cubic: the row slides, and the focused tile grows
  from 56 to 64 px.
- Page open: the focused tile zooms to fill the screen over 250 ms, like opening a Wii channel.
- Animations run on a fixed 60 Hz tick (`tick(ms)`), so the native and WASM builds render the same
  frames given the same inputs and time.

## 3. CLI mockups

Each character cell is about 6×12 px of the 240×240 screen. `[Back]` is always bottom-left and
the primary action always bottom-right. `┏━┓` marks the focused element.

**Home** (Pictures focused; the focused tile stays centered and the row slides under it):
```
┌────────────────────────────────────────┐
│ 14:23                              ⭘USB│  nav bar: clock left, USB/battery right
├────────────────────────────────────────┤
│                                        │
│  ╭──────╮   ┏━━━━━━━━┓   ╭──────╮      │  small rounded squares;
│  │  ◉   │   ┃ ▣▣▣    ┃   │  ⚙   │      │  the focused one is bigger,
│  │      │   ┃ ▣▣▣    ┃   │      │      │  with the blue outline
│  ╰──────╯   ┃ ▣▣▣    ┃   ╰──────╯      │
│              ┗━━━━━━━━┛                │
│  Camera      Pictures     Settings     │
│                                        │
├────────────────────────────────────────┤
│                ○  ●  ○                 │  bottom bar: page dots (root: no Back)
└────────────────────────────────────────┘
```

**Camera** (full screen: the picture and the nav bar only; A shoots, B flash, Center = MENU):
```
┌────────────────────────────────────────┐
│ 2:23 PM  Camera              ⚡ 76% ▭▯ │  12h clock; flash icon beside the battery
├────────────────────────────────────────┤
│        │             │                 │
│        │  live       │                 │  rule-of-thirds grid (Settings → Grid)
│────────┼─────────────┼─────────────────│
│        │  preview    │                 │
│────────┼─────────────┼─────────────────│
│        │             │                 │
└────────────────────────────────────────┘
 flash on: a white ring lights up around the display, outside the panel
```

**Pictures** (rounded thumbnails; Down past the grid reaches Back):
```
┌────────────────────────────────────────┐
│ 14:23  Pictures                    ⭘USB│
├────────────────────────────────────────┤
│  ╭──────╮  ┏━━━━━━┓  ╭──────╮          │
│  │ img  │  ┃ img  ┃  │ img  │          │  3 per row, 64 px squares
│  ╰──────╯  ┗━━━━━━┛  ╰──────╯          │
│  ╭──────╮  ╭──────╮                    │
│  │ img  │  │ img  │                    │
│  ╰──────╯  ╰──────╯                    │
├────────────────────────────────────────┤
│ ( Back )                               │  no primary action: Center opens the photo
└────────────────────────────────────────┘
```

**Viewer** (the file name is the title; Back is the only control):
```
┌────────────────────────────────────────┐
│ 14:23  IMG_0002.jpg                ⭘USB│
├────────────────────────────────────────┤
│  ╭──────────────────────────────────╮  │
│  │               photo              │  │
│  ╰──────────────────────────────────╯  │
├────────────────────────────────────────┤
│ ┏ Back ┓                               │
└────────────────────────────────────────┘
```

**Settings** (flat rounded rows; Center changes the focused value):
```
┌────────────────────────────────────────┐
│ 14:23  Settings                    ⭘USB│
├────────────────────────────────────────┤
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ Resolution               1920x1080 ┃ │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│ │ Mirror                         Off │ │
│ │ Flip vertical                  Off │ │
│ │ Grid                           Off │ │
│ │ Clock                          24h │ │  About scrolls into view below
├────────────────────────────────────────┤
│ ( Back )                               │
└────────────────────────────────────────┘
```

`make ui-preview` prints the *real* rendered frames (Home, mid-slide, mid-zoom, Pictures,
Viewer, Settings, Camera with Shoot focused, Camera with Back focused) in the terminal as truecolor half-block pixels, so these mockups get checked
against the actual code. `OUT=dir make ui-preview` also writes each frame as a 240×240 PPM. Every
frame goes through the ST7789 driver and emulator, so it's exactly what the panel would show.

## 4. Architecture: one UI, two displays

```
                    firmware/ui/  (portable C++17: no Arduino, no heap)
  input (5-way) ──▶ ui.cpp  state + animation ──▶ framebuffer (240×240 RGB565)
                                                        │
                                                 st7789.cpp driver
                                          (init sequence, CASET/RASET/RAMWR,
                                           big-endian RGB565 over SPI)
                                                        │  SPI bytes + DC flag
                        ┌───────────────────────────────┴───────────────────┐
                 device │ Arduino SPI → ST7789 panel         web (WASM)     │
                        │                           st7789_emulator.cpp     │
                        │                           decodes the same bytes  │
                        │                           into panel memory       │
                        └───────────────────────────────────────────────────┘
                                                        │
                                   web/src/device-ui: canvas 240×240 (scaled ×2)
```

- **Portable core** (`firmware/ui/`): `Framebuffer` (RGB565, rounded rects, bitmap text), `Ui`
  (screens, focus, eased animations driven by `tick(ms)`), `St7789` (turns the framebuffer into the
  SPI byte stream through a `SpiBus` interface) and `St7789Emulator` (a `SpiBus` that decodes that
  stream: `SWRESET`, `SLPOUT`, `COLMOD 0x55`, `MADCTL`, `INVON`, `CASET`, `RASET`, `RAMWR`,
  `DISPON`).
- **Device:** a `SpiBus` backed by Arduino `SPI` and the DC pin, wired up once the display is
  connected.
- **Web:** `emcc` builds `ui + st7789 + st7789_emulator` into a standalone
  `web/public/wasm/device-ui.wasm` with no JS glue and no heap. The page calls `ui_tick`,
  `ui_press`, `ui_set_time` and `ui_set_status`, then paints `panel()` (the emulator's panel
  memory) onto a canvas.
- **"Exactly the SPI output":** the web canvas shows what the emulator decoded from the driver's
  bytes, not the framebuffer directly. A driver bug (wrong window, byte order, `MADCTL`) shows up
  on the web exactly as it would on the panel.

## 5. Testing first

| Layer | Test | Runs in |
|---|---|---|
| Framebuffer | pixels of rects, rounded corners, clipping, text | `make uitest` (native C++) |
| Driver ↔ emulator | init sequence; full frame and partial windows round-trip to identical pixels; byte order; `MADCTL` rotation | `make uitest` |
| UI state | focus movement, bottom bar reachable from every page, Center-only activation, viewer, eased animation end states, status icon (none/USB/battery) | `make uitest` |
| Design rules | Back button pixel-identical on every page; arrows never change values or leave a page; no hint text; camera has no bottom bar; flash never draws on the picture | `make uitest` |
| Golden frames | FNV-1a hash of the panel after a scripted input sequence at fixed times | `make uitest` **and** Playwright against the WASM build. Both must equal the same constants: native == WASM, bit for bit |
| Site tab | Device tab renders a 240×240 canvas, keyboard maps to the 5-way switch, the USB icon appears when the camera is connected | Playwright |

## Sources

- Nintendo, *Iwata Asks: Wii Channels*: [1. Fun for the Entire Family](https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-Wii/Iwata-Asks-Wii-Channels/1-Fun-For-the-Entire-Family/1-Fun-For-the-Entire-Family-213500.html), [2. Redefining the Game-User Relationship](https://www.nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-Wii/Iwata-Asks-Wii-Channels/2-Redefining-the-Game-User-Relationship/2-Redefining-the-Game-User-Relationship-213553.html) ([iwataasks.nintendo.com](https://iwataasks.nintendo.com/interviews/wii/wii_channels/0/0/)): channels "treated equally", "lots of screens… all lined up", "experiencing rather than understanding", "fun for the entire family"
- [Wii Menu (Nintendo UK)](https://www.nintendo.com/en-gb/Wii/Wii-Channels/Wii-Menu/Wii-Menu-749371.html): Disc Channel fixed top-left, settings bottom-left, select a channel then **Start**
- Switch design analyses: [Designing for the Nintendo Switch](https://medium.com/bpxl-craft/designing-for-the-nintendo-switch-32cacbe4c02d), [Nintendo Switch UI Design](https://medium.com/@dli_li/nintendo-switch-ui-design-1eb1742515db), [Nintendo & designing humanly](https://uxdesign.cc/nintendo-designing-humanly-984626b64892): consistency across the whole system, clear hierarchy, recognizable icons

- [Wii system software (Wikipedia)](https://en.wikipedia.org/wiki/Wii_system_software): Wii Menu 4×3 grid, 4 pages, plus/minus paging, time and date on every page
- [Wii Menu (HandWiki)](https://handwiki.org/wiki/Wii_Menu), [Wii Menu (Wii Wiki)](https://wii.fandom.com/wiki/Wii_Menu)
- [List of Nintendo system fonts (NintendoWiki)](https://niwanetwork.org/wiki/List_of_Nintendo_system_fonts): Rodin NTLG
- [zuvv/WiiMenu](https://github.com/zuvv/WiiMenu), [tobieche110/wii-portfolio](https://github.com/tobieche110/wii-portfolio), [andrewplus/Wii.JS](https://github.com/andrewplus/Wii.JS/), [danintosh/Wii-Menu-HTML](https://github.com/danintosh/Wii-Menu-HTML), [cornetespoir/wii-menu-page](https://github.com/cornetespoir/wii-menu-page), [J3rr1ck/wiijs](https://github.com/J3rr1ck/wiijs)
- [Wii Menu Figma community file](https://www.figma.com/community/file/1330210065837806308/wii-menu)
- ST7789: [tinygo st7789 driver](https://pkg.go.dev/tinygo.org/x/drivers/st7789), [st7789v2 crate](https://lib.rs/crates/st7789v2), [rsemu ST7789 emulation notes](https://github.com/KarpelesLab/rsemu/issues/25): commands, `MADCTL` bits, RGB565 `COLMOD 0x55`, window wrap behavior
- XIAO ESP32-S3 + 240×240 SPI: [Seeed LVGL optimization guide](https://wiki.seeedstudio.com/round_display_animation_workshop/), [LVGL ESP32 drivers](https://github.com/lvgl/lvgl_esp32_drivers)
