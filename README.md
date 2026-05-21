# ⚡ TeamSpace - Asignador de Equipos Distribuido

TeamSpace es un sistema distribuido en tiempo real diseñado para gestionar espacios virtuales, registrar alumnos y asignar equipos de forma automática mediante algoritmos. El sistema está construido con una arquitectura basada en microservicios independientes que se comunican entre sí utilizando **gRPC** y exponen la interfaz al cliente a través de **WebSockets**.

## 🏗️ Arquitectura y Tecnologías

El sistema se divide lógicamente en tres máquinas (servicios) y un cliente web. No utiliza contenedores, por lo que cada servicio se ejecuta de forma nativa en su respectivo entorno de Node.js.

### Tecnologías Utilizadas
- **Frontend**: HTML5, CSS3 (Variables nativas, diseño moderno, modo oscuro), Vanilla JavaScript, WebSockets (`ws`).
- **Backend / Microservicios**: Node.js
- **Comunicación en tiempo real (Cliente - Servidor)**: WebSockets (librería `ws`)
- **Comunicación interna (Servidor - Servidor)**: gRPC (`@grpc/grpc-js`), Protocol Buffers (`@grpc/proto-loader`)

### Estructura del Sistema

1. **Máquina 1 (Gestión de Usuarios y Espacios)** - `maquina1-usuarios/`
   - Servidor gRPC que maneja la persistencia en memoria de los espacios, los códigos de acceso y los alumnos registrados.
2. **Máquina 3 (Matchmaking / Algoritmos)** - `maquina3-matchmaking/`
   - Servidor gRPC encargado de la lógica pesada. Toma una lista de alumnos y un algoritmo (Aleatorio o Secuencial) y devuelve la estructura de los equipos formados.
3. **Máquina 2 (API Gateway)** - `maquina2-gateway/`
   - Servidor WebSocket que actúa como puente entre el frontend y los microservicios gRPC.
   - Mantiene las conexiones activas de los docentes y alumnos.
   - Realiza llamadas RPC a la Máquina 1 y Máquina 3 según los eventos recibidos.
4. **Frontend** - `frontend/`
   - Interfaz web reactiva sin recargas de página.
   - Panel de docente con sistema de credenciales configurables guardadas localmente (`localStorage`).

---

## 🚀 Guía de Instalación y Ejecución

Para ejecutar este proyecto en un entorno distribuido real, necesitas instalar Node.js en las tres máquinas. 

### Prerrequisitos (En todas las máquinas backend)
```bash
# Navegar al directorio de cada máquina y ejecutar:
npm install
```
*Esto instalará las dependencias necesarias (`@grpc/grpc-js`, `@grpc/proto-loader`, y `ws` para el gateway).*

### Paso 1: Levantar Máquina 1 (Gestión de Usuarios)
En la terminal de la Máquina 1, ubícate en el directorio `maquina1-usuarios/`:
```bash
node server.js
```
*Por defecto, este servicio gRPC correrá en el puerto `50051`. Toma nota de la IP de esta máquina si el gateway está en otra red.*

### Paso 2: Levantar Máquina 3 (Matchmaking)
En la terminal de la Máquina 3, ubícate en el directorio `maquina3-matchmaking/`:
```bash
node server.js
```
*Por defecto, este servicio gRPC correrá en el puerto `50052`. Toma nota de la IP de esta máquina.*

### Paso 3: Levantar Máquina 2 (Gateway WebSocket)
En la terminal de la Máquina 2 (Gateway), ubícate en el directorio `maquina2-gateway/`. 
Asegúrate de que en el código de `server.js` de esta máquina, las direcciones IP hacia la Máquina 1 y 3 sean las correctas (actualmente apuntan a `localhost` o las IPs que hayas configurado en el archivo).

```bash
node server.js
```
*Por defecto, el servidor WebSocket correrá en el puerto `8080`. Toma nota de la IP de esta máquina, ya que el Frontend se conectará a ella.*

### Paso 4: Levantar el Frontend
El frontend es completamente estático. Puedes servirlo desde cualquier máquina utilizando un servidor HTTP básico.
Por ejemplo, usando Python 3 desde el directorio `frontend/`:
```bash
python3 -m http.server 8000
```
Luego, abre el navegador en `http://localhost:8000` (o la IP correspondiente).

---

## 🎮 Uso de la Aplicación

1. **Configuración de Conexión:**
   - Abre la aplicación en el navegador.
   - En la parte superior derecha, haz clic en el botón del engranaje `⚙️`.
   - Ingresa la URL WebSocket del Gateway (ej. `ws://IP_MAQUINA_2:8080`) y presiona "Conectar". El indicador superior debe decir "Conectado" en color esmeralda.

2. **Panel de Docente:**
   - Ve a la pestaña **Docente**.
   - La primera vez te pedirá que configures un Usuario y Contraseña. 
   - Una vez configurado, accederás al panel donde podrás crear un Espacio (con un código, límite de alumnos por equipo y seleccionando el algoritmo: Aleatorio o Por Orden).
   - Comparte el "Código del espacio" con los alumnos.

3. **Registro de Alumno:**
   - Los alumnos deben abrir la aplicación y usar la pestaña **Alumno**.
   - Deben ingresar el "Código del espacio" proporcionado por el docente, su matrícula y su nombre completo.
   - Aparecerán en tiempo real en la pantalla del docente.

4. **Asignación de Equipos:**
   - Cuando todos los alumnos se hayan unido, el Docente presiona el botón **⚡ Asignar**.
   - El Gateway consultará a la Máquina 3 (Matchmaking), generará los equipos y enviará los resultados en tiempo real a todas las pantallas de los alumnos y del docente.

## ✨ Características Destacadas
- **UI/UX basada en investigación**: Paleta de colores optimizada para reducir la fatiga visual (fondos azul medianoche, acentos índigo y esmeralda).
- **Seguridad**: Autenticación para el panel docente con credenciales gestionadas de forma segura.
- **Microservicios Puros**: Intercomunicación binaria eficiente gracias a gRPC y Protocol Buffers.
