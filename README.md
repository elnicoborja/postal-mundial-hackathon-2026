# Postal Mundial

Prototipo presentado al Cursor Hackatón México, CDMX, noviembre de 2026.

Postal Mundial propone conectar vistas de la ciudad, fotógrafos y espacios con una experiencia de captura, selección, compra y entrega privada. Cover Rat es la extensión prevista para estilos y marcos. La impresión local sería opcional, sujeta a capacidad y horario confirmados.

## Estado de esta entrega

Se incluyen dos módulos locales, todavía separados:

- **HP01:** mapa conceptual, decisiones individuales de ejemplo y QR distintos por participante. Los enlaces caducan y se pueden revocar. Una persona menor o de edad incierta sigue una ruta de aprobación del responsable. No se verifica identidad ni tutela. Solo se consulta estado ficticio, no fotografías personales.
- **HP02:** acceso a cámara mediante getUserMedia, ráfaga de hasta 30 cuadros aceptados, revisión de todas las tomas, selección manual, original o monocromo, bloqueo del archivo con SHA-256 y descarga local de esos mismos bytes. La ruta de cámara está implementada; las pruebas automatizadas usan cámara sintética y falta la aceptación en dispositivos físicos.

**La integración CoDi/pey, el webhook, el pago real y la entrega privada de archivos aún no están implementados.** El registro de cuentas de prueba no equivale a una transacción verificada. Tampoco hay reservas, impresión operativa, reconocimiento facial o clasificación automática de edad.

## Ejecutar HP01

Node.js 22 o posterior:

```text
cd hp01
npm ci --ignore-scripts
npm test
npm start
```

Abre http://127.0.0.1:5608 en la misma computadora. Los QR locales no funcionan desde otro teléfono. Reiniciar el proceso borra los grupos ficticios e invalida sus accesos. No uses datos reales de menores ni publiques este servidor como servicio para clientes.

## Ejecutar HP02

En otra terminal:

```text
cd hp02
npm test
npm start
```

Abre http://127.0.0.1:5609. La aplicación y el servidor no tienen dependencias de ejecución. La cámara solo se solicita al pulsar el control correspondiente, sin micrófono. Prueba inicialmente con adultos que acepten participar. Las imágenes permanecen en la pestaña y no se suben; el reinicio libera referencias y detiene la cámara, sin prometer borrado físico de memoria ni de descargas realizadas.

Para repetir las pruebas de navegador con cámara sintética:

```text
npm ci --ignore-scripts
npx playwright install chromium
npm run test:browser
```

Si necesitas conservar otras revisiones de Chromium en la caché de pruebas, configura PLAYWRIGHT_SKIP_BROWSER_GC=1 antes de instalar. No se requiere abrir un perfil personal del navegador.

## Evidencia y límites

Los recibos locales previos a esta publicación registraron 13 pruebas HP01 aprobadas, 4 pruebas de estado HP02 aprobadas y 7 grupos de comprobaciones HP02 con cámara sintética, incluyendo selección, digest, reinicio, errores y ausencia de subidas. Las pruebas son reproducibles desde el código incluido. No sustituyen una prueba física de cámara/teléfono, escaneo óptico de QR, verificación legal ni aceptación de una compra real.

Las escenas HP01 son ilustraciones generadas y los lugares son candidatos sin acuerdos operativos. Las 30 posiciones de HP01 repiten una ilustración; HP02 cuenta cuadros realmente aceptados por su ruta de captura. No se presentan como una sola aplicación integrada.

## Trabajo previo y trabajo del hackatón

Postal Mundial y Cover Rat son conceptos/proyectos previos. Se reutilizan identidad visual, tipografía y material conceptual. Durante el periodo del hackatón se desarrollaron estos módulos de acceso individual, controles de grupo, QR revocables y captura/selección local con sus pruebas. La integración CoDi es el siguiente paso y se declara pendiente.

El repositorio público permite revisar el prototipo; no concede por sí solo una licencia abierta nueva sobre marca, tipografías o materiales de terceros. Las dependencias conservan sus licencias respectivas. No incluye credenciales, cuentas bancarias, retratos de clientes, contratos privados ni documentos internos de negocio.

Equipo: Postal Mundial. Autor: Nico Borja.
