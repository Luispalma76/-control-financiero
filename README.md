# Control Financiero — Guía de instalación (paso a paso, sin experiencia técnica)

Vas a dejar esta app funcionando en tu celular y PC, sincronizada entre ambos, con
escaneo de boletas por cámara. Toma entre 30-45 minutos la primera vez. Sigue el
orden exacto.

---

## PARTE 1 — Crear las 4 cuentas necesarias (todas gratis)

### 1.1 Cuenta de GitHub (donde vive el código)
1. Ve a **github.com/join**
2. Crea tu cuenta con tu correo (usa el mismo correo para todo si puedes)
3. Confirma el correo que te llega

### 1.2 Cuenta de Vercel (quien publica la app en internet)
1. Ve a **vercel.com**
2. Clic en "Sign Up" → elige "Continue with GitHub" (así quedan conectadas)
3. Autoriza el acceso

### 1.3 Cuenta de Firebase (donde se guardan tus datos, sincronizados)
1. Ve a **console.firebase.google.com**
2. Inicia sesión con tu cuenta de Google (o crea una)
3. Clic en "Crear un proyecto" → nómbralo "control-financiero" → sigue los pasos (puedes desactivar Google Analytics, no lo necesitas)
4. Dentro del proyecto, en el menú izquierdo: **Compilación > Firestore Database**
5. Clic en "Crear base de datos" → elige **"Iniciar en modo de producción"** → elige la región (ej. `southamerica-east1`) → Habilitar
6. Ve a **Reglas** (pestaña arriba de Firestore) y reemplaza el contenido por esto, luego "Publicar":
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
   > Nota de seguridad: esto deja la base de datos abierta a quien tenga el link exacto de tu proyecto (no es indexable ni adivinable fácilmente). Es aceptable para uso personal. Si más adelante quieres blindarla con clave, dímelo y lo agregamos.
7. Ahora ve a **⚙️ Configuración del proyecto** (ícono de engranaje, arriba a la izquierda) → **Tus apps** → clic en el ícono `</>` (Web) → nómbrala "control-financiero-web" → Registrar app
8. Te va a mostrar un bloque de código con `apiKey`, `authDomain`, `projectId`, etc. **Copia esos valores**, los vas a necesitar en el Paso 2.

### 1.4 API key de Anthropic (para que el escaneo de boletas funcione)
1. Ve a **console.anthropic.com**
2. Crea tu cuenta
3. Ve a **Billing** y carga un método de pago (el uso de esta función es muy bajo costo: cada boleta escaneada cuesta centavos de dólar)
4. Ve a **API Keys** → "Create Key" → nómbrala "control-financiero" → **cópiala y guárdala en un lugar seguro** (solo se muestra una vez)

---

## PARTE 2 — Configurar el código

1. Abre el archivo **config.js** de esta carpeta
2. Reemplaza los valores `PEGA_AQUI_...` por los datos que copiaste de Firebase en el paso 1.3.8
3. Guarda el archivo

---

## PARTE 3 — Subir el código a GitHub (sin usar terminal)

1. Ve a **github.com** → clic en el botón verde "New" (nuevo repositorio)
2. Nómbralo `control-financiero` → déjalo en "Public" o "Private" (Private es más privado, ambos funcionan) → "Create repository"
3. En la pantalla que aparece, busca el link **"uploading an existing file"**
4. Arrastra **todos los archivos y carpetas de esta carpeta** (index.html, style.css, app.js, config.js, manifest.json, sw.js, la carpeta `api/`, la carpeta `icons/`) a esa página
5. Abajo, clic en "Commit changes"

---

## PARTE 4 — Publicar en Vercel

1. Ve a **vercel.com/new**
2. Busca y selecciona el repositorio `control-financiero` que acabas de subir → "Import"
3. Deja todas las opciones por defecto → clic en **"Deploy"**
4. Espera ~1 minuto. Te va a dar una URL tipo `control-financiero-xxxx.vercel.app`

### Ahora agrega tu llave de Anthropic (paso obligatorio para el escaneo):
1. En el proyecto dentro de Vercel, ve a **Settings > Environment Variables**
2. Agrega:
   - Name: `ANTHROPIC_API_KEY`
   - Value: (pega la key que copiaste en el paso 1.4)
3. Guarda
4. Ve a la pestaña **Deployments** → en el último deploy, clic en los 3 puntos → **"Redeploy"** (esto es necesario para que tome la nueva variable)

---

## PARTE 5 — Instalar en tu celular y PC

1. Abre la URL de Vercel (`https://control-financiero-xxxx.vercel.app`) en tu celular, desde **Chrome o Safari** (no dentro de otra app)
2. Celular Android (Chrome): menú (⋮) → "Instalar aplicación" o "Agregar a pantalla de inicio"
3. iPhone (Safari): botón compartir (□↑) → "Agregar a pantalla de inicio"
4. Abre la misma URL en tu PC, en Chrome → ícono de instalar en la barra de direcciones (o menú → "Instalar Control Financiero")

Listo — queda como app en ambos, con el mismo ícono, y **todo lo que cargues en un dispositivo aparece automáticamente en el otro**, porque los datos viven en Firebase, no en el celular.

---

## Cómo probar que el escaneo de boletas funciona
1. Abre la app → pestaña "Agregar" → "Escanear boleta o factura"
2. Da permiso de cámara cuando lo pida el navegador
3. Enfoca una boleta y toca el botón blanco
4. En unos segundos debería rellenar monto, fecha, comercio y categoría — revisa y ajusta si algo quedó mal, luego "Guardar movimiento"

## Si algo falla
- **"Error de conexión" al abrir la app** → revisa que copiaste bien los datos de Firebase en `config.js`
- **El escaneo da error** → revisa que agregaste `ANTHROPIC_API_KEY` en Vercel y que hiciste "Redeploy" después
- **La cámara no abre** → asegúrate de estar en Chrome/Safari (no en una app embebida) y dar el permiso cuando lo pida

Cualquier error, mándame el mensaje exacto que te sale y seguimos ajustando desde aquí.
