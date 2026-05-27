/**
 * ═══════════════════════════════════════════════════════════════
 *  MÁQUINA 2 — Gateway de Comunicación (Orquestador Reactivo)
 *  WebSocket Server  |  Puerto 8080
 *  gRPC Client → Máquina 1 (IP_MAQUINA1:50051)
 *  gRPC Client → Máquina 3 (IP_MAQUINA3:50052)
 *
 *  Responsabilidades:
 *    • Mantener conexiones WebSocket con el frontend (docentes y alumnos)
 *    • Enrutar mensajes JSON del frontend a las llamadas gRPC correspondientes
 *    • Hacer broadcast reactivo de eventos (nuevo alumno, equipos asignados)
 *    • Agrupar conexiones por space_code para difusión selectiva
 *
 *  ⚠️  IMPORTANTE: Reemplaza IP_MAQUINA1 e IP_MAQUINA3 con las IPs reales
 *      de tu red local antes de ejecutar este servicio.
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

const path     = require("path");
const http     = require("http");
const fs       = require("fs");
const WebSocket = require("ws");
const grpc     = require("@grpc/grpc-js");
const loader   = require("@grpc/proto-loader");

// ── Configuración de IPs ─────────────────────────────────────
// ⚠️  CAMBIAR ESTAS IPs POR LAS REALES DE TU RED LOCAL
const IP_MAQUINA1 = process.env.IP_M1 || "192.168.1.101"; // Usuarios y Espacios
const IP_MAQUINA3 = process.env.IP_M3 || "192.168.1.103"; // Matchmaking
const WS_PORT     = parseInt(process.env.PORT, 10) || 8080;

// ── Carga del proto compartido ───────────────────────────────
const PROTO_PATH = path.join(__dirname, "..", "proto", "teamspace.proto");

const packageDef = loader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs:    String,
  enums:    String,
  defaults: true,
  oneofs:   true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDef);
const teamspace       = protoDescriptor.teamspace;

// ── Clientes gRPC ────────────────────────────────────────────
const userClient = new teamspace.UserSpaceService(
  `${IP_MAQUINA1}:50051`,
  grpc.credentials.createInsecure()
);

const matchClient = new teamspace.MatchmakingService(
  `${IP_MAQUINA3}:50052`,
  grpc.credentials.createInsecure()
);

console.log(`[gRPC] Cliente Usuarios → ${IP_MAQUINA1}:50051`);
console.log(`[gRPC] Cliente Matchmaking → ${IP_MAQUINA3}:50052`);

// ── Promisificar llamadas gRPC ───────────────────────────────
const grpcCall = (client, method, request) =>
  new Promise((resolve, reject) => {
    client[method](request, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });

// ── Registro de conexiones WebSocket por espacio ─────────────
// Map<space_code, Set<WebSocket>>  — para broadcast selectivo
const spaceRooms = new Map();

// Map<WebSocket, { role, space_code, student_id }>
const clientMeta = new Map();

// Map<space_code, Team[]> — para persistir equipos estables e incrementales en tiempo real
const spaceTeams = new Map();

/**
 * Agrupa al alumno en un equipo de forma estable e incremental sin alterar
 * a los compañeros ya asignados.
 */
function assignStableTeam(spaceCode, student, maxPerTeam, algorithm) {
  if (!spaceTeams.has(spaceCode)) {
    spaceTeams.set(spaceCode, []);
  }
  const teams = spaceTeams.get(spaceCode);

  // Evitar duplicados en el equipo
  const exists = teams.some(t => t.members.some(m => m.student_id === student.student_id));
  if (exists) return teams;

  if (algorithm === "ORDER") {
    // ORDER: Busca el primer equipo disponible que tenga espacio
    let placed = false;
    for (const team of teams) {
      if (team.members.length < maxPerTeam) {
        team.members.push(student);
        placed = true;
        break;
      }
    }
    if (!placed) {
      teams.push({
        team_number: teams.length + 1,
        members: [student]
      });
    }
  } else {
    // RANDOM: Filtra equipos disponibles, asigna aleatoriamente a uno de ellos,
    // garantizando que los alumnos ya asignados permanezcan estables.
    const availableTeams = teams.filter(t => t.members.length < maxPerTeam);
    if (availableTeams.length > 0) {
      const randomTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];
      randomTeam.members.push(student);
    } else {
      teams.push({
        team_number: teams.length + 1,
        members: [student]
      });
    }
  }

  return teams;
}

function joinRoom(ws, spaceCode) {
  if (!spaceRooms.has(spaceCode)) {
    spaceRooms.set(spaceCode, new Set());
  }
  spaceRooms.get(spaceCode).add(ws);
}

function leaveRoom(ws) {
  for (const [spaceCode, room] of spaceRooms.entries()) {
    room.delete(ws);
    if (room.size === 0) {
      spaceRooms.delete(spaceCode);
    }
  }
}

/**
 * Broadcast un mensaje JSON a todos los clientes de un espacio.
 * @param {string} spaceCode
 * @param {object} payload
 */
function broadcastToSpace(spaceCode, payload) {
  const room = spaceRooms.get(spaceCode);
  if (!room) return;
  const data = JSON.stringify(payload);
  room.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// ── Handlers de mensajes WebSocket ───────────────────────────

/**
 * Mensaje: CREATE_SPACE
 * Payload: { type, space_code, max_per_team, algorithm }
 * Rol:     Docente
 */
async function handleCreateSpace(ws, msg) {
  try {
    const res = await grpcCall(userClient, "CreateSpace", {
      config: {
        space_code:   msg.space_code,
        max_per_team: parseInt(msg.max_per_team, 10),
        algorithm:    msg.algorithm, // "RANDOM" | "ORDER"
      },
    });

    // Registrar al docente en la sala
    if (res.success) {
      clientMeta.set(ws, { role: "teacher", space_code: res.space_code });
      joinRoom(ws, res.space_code);
    }

    ws.send(JSON.stringify({
      type:       "CREATE_SPACE_RESULT",
      success:    res.success,
      message:    res.message,
      space_code: res.space_code,
    }));

  } catch (err) {
    ws.send(JSON.stringify({ type: "ERROR", message: err.message }));
  }
}

/**
 * Mensaje: JOIN_SPACE
 * Payload: { type, space_code, student_id, student_name }
 * Rol:     Alumno
 */
async function handleJoinSpace(ws, msg) {
  try {
    const res = await grpcCall(userClient, "JoinSpace", {
      space_code:   msg.space_code,
      student_id:   msg.student_id,
      student_name: msg.student_name || msg.student_id,
    });

    if (res.success) {
      const code = msg.space_code.trim().toUpperCase();
      clientMeta.set(ws, {
        role:       "student",
        space_code: code,
        student_id: msg.student_id,
      });
      joinRoom(ws, code);

      // Responder al alumno que se unió con éxito
      ws.send(JSON.stringify({
        type:       "JOIN_SPACE_RESULT",
        success:    true,
        space_code: code,
        student:    res.student,
        message:    res.message,
      }));

      // Notificar a TODOS en el espacio (incluido el docente) del nuevo alumno
      broadcastToSpace(code, {
        type:         "STUDENT_JOINED",
        space_code:   code,
        student:      res.student,
        member_count: res.member_count,
        message:      res.message,
      });

      // ── Asignación Automática de Equipos en Tiempo Real ──
      try {
        // 1. Obtener configuración del espacio
        const configRes = await grpcCall(userClient, "GetSpaceConfig", { space_code: code });
        if (configRes.success) {
          // 2. Obtener la lista completa y actualizada de alumnos
          const membersRes = await grpcCall(userClient, "GetSpaceMembers", { space_code: code });
          if (membersRes.success && membersRes.members.length > 0) {
            // 3. Solicitar la asignación/barajado al servicio de Matchmaking (Máquina 3)
            const teamsRes = await grpcCall(matchClient, "AssignTeams", {
              students:     membersRes.members,
              max_per_team: configRes.config.max_per_team,
              algorithm:    configRes.config.algorithm,
            });

            if (teamsRes.success) {
              // 4. Actualizar la caché de asignación estable
              spaceTeams.set(code, teamsRes.teams);

              // 5. Broadcast del resultado en tiempo real de manera reactiva e inmediata
              broadcastToSpace(code, {
                type:           "TEAMS_ASSIGNED",
                space_code:     code,
                teams:          teamsRes.teams,
                total_teams:    teamsRes.total_teams,
                total_students: teamsRes.total_students,
                algorithm:      configRes.config.algorithm,
                message:        `Equipos actualizados automáticamente en tiempo real por ingreso de alumno con algoritmo ${configRes.config.algorithm}.`,
              });
            }
          }
        }
      } catch (assignErr) {
        console.error(`[ERROR] Error en asignación automática para ${code}:`, assignErr.message);
      }
    } else {
      // Solo responder al alumno que intentó entrar
      ws.send(JSON.stringify({
        type:       "JOIN_SPACE_RESULT",
        success:    false,
        space_code: msg.space_code.trim().toUpperCase(),
        message:    res.message,
      }));
    }

  } catch (err) {
    ws.send(JSON.stringify({ type: "ERROR", message: err.message }));
  }
}

/**
 * Mensaje: ASSIGN_TEAMS
 * Payload: { type, space_code }
 * Rol:     Docente (inicia la asignación)
 */
async function handleAssignTeams(ws, msg) {
  try {
    const code = (msg.space_code || "").trim().toUpperCase();

    // 1. Obtener configuración del espacio
    const configRes = await grpcCall(userClient, "GetSpaceConfig", { space_code: code });
    if (!configRes.success) {
      return ws.send(JSON.stringify({ type: "ERROR", message: configRes.message }));
    }

    // 2. Obtener lista de alumnos
    const membersRes = await grpcCall(userClient, "GetSpaceMembers", { space_code: code });
    if (!membersRes.success || membersRes.members.length === 0) {
      return ws.send(JSON.stringify({
        type:    "ERROR",
        message: "No hay alumnos registrados en el espacio para asignar.",
      }));
    }

    // 3. Llamar al servicio de Matchmaking (Máquina 3) para barajado/asignación completa
    const teamsRes = await grpcCall(matchClient, "AssignTeams", {
      students:     membersRes.members,
      max_per_team: configRes.config.max_per_team,
      algorithm:    configRes.config.algorithm,
    });

    if (!teamsRes.success) {
      return ws.send(JSON.stringify({ type: "ERROR", message: teamsRes.message }));
    }

    // 4. Actualizar la caché de asignación estable con la nueva distribución completa
    spaceTeams.set(code, teamsRes.teams);

    // 5. Broadcast del resultado a TODOS en el espacio
    broadcastToSpace(code, {
      type:           "TEAMS_ASSIGNED",
      space_code:     code,
      teams:          teamsRes.teams,
      total_teams:    teamsRes.total_teams,
      total_students: teamsRes.total_students,
      algorithm:      configRes.config.algorithm,
      message:        teamsRes.message,
    });

  } catch (err) {
    ws.send(JSON.stringify({ type: "ERROR", message: `gRPC error: ${err.message}` }));
  }
}

/**
 * Mensaje: GET_MEMBERS
 * Payload: { type, space_code }
 * Permite al docente solicitar la lista actual.
 */
async function handleGetMembers(ws, msg) {
  try {
    const code = (msg.space_code || "").trim().toUpperCase();
    const res  = await grpcCall(userClient, "GetSpaceMembers", { space_code: code });

    ws.send(JSON.stringify({
      type:       "MEMBERS_LIST",
      space_code: code,
      success:    res.success,
      members:    res.members,
      message:    res.message,
    }));
  } catch (err) {
    ws.send(JSON.stringify({ type: "ERROR", message: err.message }));
  }
}

// ── Router principal de mensajes ─────────────────────────────
async function routeMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return ws.send(JSON.stringify({ type: "ERROR", message: "JSON inválido." }));
  }

  console.log(`[WS →] ${msg.type}`, JSON.stringify(msg).slice(0, 120));

  switch (msg.type) {
    case "CREATE_SPACE":  return handleCreateSpace(ws, msg);
    case "JOIN_SPACE":    return handleJoinSpace(ws, msg);
    case "ASSIGN_TEAMS":  return handleAssignTeams(ws, msg);
    case "GET_MEMBERS":   return handleGetMembers(ws, msg);
    default:
      ws.send(JSON.stringify({ type: "ERROR", message: `Tipo de mensaje desconocido: ${msg.type}` }));
  }
}

// ── Servidor HTTP + WebSocket ────────────────────────────────
const httpServer = http.createServer((req, res) => {
  // Servir frontend/index.html
  const urlPath = req.url.split('?')[0];
  if (urlPath === "/" || urlPath === "/index.html") {
    const htmlPath = path.join(__dirname, "..", "frontend", "index.html");
    fs.readFile(htmlPath, "utf8", (err, content) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Error al cargar la aplicación frontend: " + err.message);
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
      }
    });
  } else {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado.");
  }
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Nueva conexión desde ${ip}`);

  ws.on("message", (data) => routeMessage(ws, data));

  ws.on("close", () => {
    const meta = clientMeta.get(ws);
    console.log(`[WS] Desconectado: ${meta ? JSON.stringify(meta) : ip}`);
    leaveRoom(ws);
    clientMeta.delete(ws);
  });

  ws.on("error", (err) => {
    console.error(`[WS ERROR] ${err.message}`);
  });

  // Mensaje de bienvenida
  ws.send(JSON.stringify({ type: "CONNECTED", message: "Gateway listo." }));
});

httpServer.listen(WS_PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  MÁQUINA 2 — Gateway de Comunicación         ║");
  console.log(`║  WebSocket escuchando en 0.0.0.0:${WS_PORT}      ║`);
  console.log(`║  → gRPC Usuarios:    ${IP_MAQUINA1}:50051   ║`);
  console.log(`║  → gRPC Matchmaking: ${IP_MAQUINA3}:50052   ║`);
  console.log("╚══════════════════════════════════════════════╝");
});
