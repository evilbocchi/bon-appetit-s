# Bon Appetit S - Stamina Challenge

A high-intensity rhythm game and stamina challenge based on the "Bon Appetit S" (Oldskool HappyHardcore Remix). This project is designed to test your finger speed and consistency across various BPMs.

## How to Play

1.  **Select BPM:** Use the buttons in the menu to set your target speed.
2.  **Bind Keys:** During the countdown, press any key to set your primary and secondary tapping keys.
3.  **Tap the Stream:** No aiming required! Just tap consistently to the rhythm.
4.  **Stay Focused:** In normal mode, missing a note or hitting outside the tight window will result in a failure. Use **Baby Mode** if you want to practice without failing.

### COOP/COEP Requirement

Because this project uses `SharedArrayBuffer`, it requires specific security headers to be served by the web server:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

A `_headers` file is included in the `public/` directory for platforms like Cloudflare Pages or Netlify.

## Development

To run this project locally:

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    bun install
    ```
3.  Start the development server:
    ```bash
    bun dev
    ```
4.  Build for production:
    ```bash
    bun run build
    ```

## Project Roadmap

- [x] Initial release!
- [ ] DMCA takedown by A-1 Pictures
- [ ] Plushies and advertisements

## Credits

- **Original Song:** Bon Appetit S (Oldskool HappyHardcore Remix)
- **Beatmap/Concept:** Inspired by [the beatmap on osu!](https://osu.ppy.sh/beatmapsets/862297)

## License

[MIT](LICENSE)
