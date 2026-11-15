# iDaft · otra dimensión

Launchpad 3D hecho con [three.js](https://threejs.org/) y la Web Audio API. Toca los samples con el teclado, el ratón o la pantalla táctil, mientras la escena (rejilla de neón, túnel hexagonal, portal y núcleo reactivo) responde a cada golpe y al pulso de la base.

**Demo:** https://luismorenolopera.github.io/idaft/ · La versión original sigue en [`/clasico`](https://luismorenolopera.github.io/idaft/clasico/).

## Funciones

- **32 pads en 3D** (banco A y banco B, 4×4 cada uno) con partículas, ondas, palabras que salen volando y bloom.
- **Teclado**: banco A en `1-4 / Q-R / A-F / Z-V`, banco B en `7-0 / U-P / J-Ñ / M-‑`. Las etiquetas se adaptan a la distribución del teclado si el navegador lo permite.
- **Base sincronizada** (123 BPM): arranca siempre en el siguiente compás, con metrónomo visual.
- **Cuantización** (libre, 1/4, 1/8, 1/16): los golpes caen a tempo.
- **Roll**: mantén `Shift` (o activa *Roll* en móvil) para repetir un pad a tempo.
- **Looper** de 1, 2 o 4 compases con capas, deshacer y borrar.
- **FX**: filtro paso bajo, eco y velocidad (cambia tempo y tono de todo a la vez).
- **Grabar mezcla**: graba lo que suena y lo descarga como archivo de audio.
- **Reto**: juego de ritmo; golpea cada pad cuando su anillo se cierre. Puntuación, combos, rango y récord guardado.
- Multitáctil, pantalla completa y diseño adaptado a móvil en vertical.

## Desarrollo

Es un sitio estático, sin build. Para probarlo en local:

```bash
python3 -m http.server
# abre http://localhost:8000
```

`three.js` (r170) está incluido en `vendor/three/` para no depender de un CDN.
`js/pads.json` define los pads (etiqueta, archivo y banco), `js/audio.js` el motor de audio,
`js/scene.js` la escena 3D y `js/main.js` la interacción, el looper y el modo reto.
