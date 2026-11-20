# Layout preview

Screenshots every screen at phone, tablet and desktop widths, with a fake
signed-in session and a mocked backend. Nothing here touches the real stack
or the live `out/` directory.

Set up once, outside the repo:

    mkdir -p /tmp/gocash-preview && cd /tmp/gocash-preview
    npm init -y && npm install playwright-core@1.47.2
    cp ~/gocash-app/scripts/preview/{preview.js,build.sh} .

Then, after changing a screen:

    ./build.sh                                  # builds a scratch copy
    mkdir -p shots && node preview.js src/out shots

`preview.js` expects the Chromium that Playwright 1.47 downloads
(`~/.cache/ms-playwright/chromium-1140`). The mock data lives at the top of
`preview.js`; add a row there to see a new state.

## Checking that nothing overflows

    node audit.js src/out shots

Loads every screen (plus login and onboarding) at eleven widths from 320 to
1920 px and reports any page that scrolls sideways, any element that sticks
out of the viewport, and any script error. It also prints, per width, whether
the sidebar or the tab bar is showing. Run it after any layout change.
