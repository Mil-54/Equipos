/**
 * ═══════════════════════════════════════════════════════════════
 *  MÁQUINA 1 — Microservicio de Usuarios y Espacios
 *  Servidor gRPC  |  Puerto 50051
 *
 *  Responsabilidades:
 *    • Crear y almacenar configuraciones de espacios (en memoria)
 *    • Validar códigos de acceso de alumnos
 *    • Registrar alumnos en espacios
 *    • Responder consultas de configuración y lista de miembros
 *
 *  IP de escucha: 0.0.0.0:50051  (acepta toda la red local)
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

const path   = require("path");
const grpc   = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");

// ── Carga del archivo proto ──────────────────────────────────
const PROTO_PATH = path.join(__dirname, "..", "proto", "teamspace.proto");

const packageDef = loader.loadSync(PROTO_PATH, {
  keepCase:     true,
  longs:        String,
  enums:        String,
  defaults:     true,
  oneofs:       true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDef);
const teamspace       = protoDescriptor.teamspace;

// ── Almacenamiento en memoria ────────────────────────────────
// Map<spaceCode, { config: SpaceConfig, members: Student[] }>
const spaces = new Map();

// ── Implementación de los handlers gRPC ─────────────────────

/**
 * CreateSpace — El docente crea un nuevo espacio.
 * Si el código ya existe, retorna error.
 */
function createSpace(call, callback) {
  const { config } = call.request;

  if (!config || !config.space_code || !config.max_per_team || !config.algorithm) {
    return callback(null, {
      success:    false,
      message:    "Configuración incompleta: se requieren space_code, max_per_team y algorithm.",
      space_code: "",
    });
  }

  const code = config.space_code.trim().toUpperCase();

  if (spaces.has(code)) {
    return callback(null, {
      success:    false,
      message:    `El espacio con código "${code}" ya existe.`,
      space_code: code,
    });
  }

  spaces.set(code, {
    config: { ...config, space_code: code },
    members: [],
  });

  console.log(`[+] Espacio creado: ${code} | max=${config.max_per_team} | algo=${config.algorithm}`);

  callback(null, {
    success:    true,
    message:    `Espacio "${code}" creado exitosamente.`,
    space_code: code,
  });
}

/**
 * JoinSpace — Un alumno solicita unirse a un espacio existente.
 * Valida el código, evita duplicados y agrega el alumno.
 */
function joinSpace(call, callback) {
  const { space_code, student_id, student_name } = call.request;

  if (!space_code || !student_id) {
    return callback(null, {
      success:      false,
      message:      "Se requieren space_code y student_id.",
      student:      null,
      member_count: 0,
    });
  }

  const code = space_code.trim().toUpperCase();
  const space = spaces.get(code);

  if (!space) {
    return callback(null, {
      success:      false,
      message:      `El espacio "${code}" no existe.`,
      student:      null,
      member_count: 0,
    });
  }

  // Verificar si el alumno ya está registrado
  const duplicate = space.members.find(m => m.student_id === student_id.trim());
  if (duplicate) {
    return callback(null, {
      success:      false,
      message:      `El alumno "${student_id}" ya está registrado en el espacio.`,
      student:      duplicate,
      member_count: space.members.length,
    });
  }

  const student = {
    student_id:  student_id.trim(),
    name:        (student_name || student_id).trim(),
    joined_at:   Date.now().toString(), // milisegundos como string (proto: int64 → string)
  };

  space.members.push(student);
  console.log(`[+] Alumno registrado: ${student.student_id} → Espacio ${code} (${space.members.length} alumnos)`);

  callback(null, {
    success:      true,
    message:      `Alumno "${student.name}" registrado en el espacio "${code}".`,
    student,
    member_count: space.members.length,
  });
}

/**
 * GetSpaceMembers — Devuelve la lista de alumnos en un espacio.
 */
function getSpaceMembers(call, callback) {
  const code = (call.request.space_code || "").trim().toUpperCase();
  const space = spaces.get(code);

  if (!space) {
    return callback(null, {
      success: false,
      message: `El espacio "${code}" no existe.`,
      members: [],
    });
  }

  callback(null, {
    success: true,
    message: `${space.members.length} alumno(s) encontrado(s).`,
    members: space.members,
  });
}

/**
 * GetSpaceConfig — Devuelve la configuración de un espacio.
 */
function getSpaceConfig(call, callback) {
  const code = (call.request.space_code || "").trim().toUpperCase();
  const space = spaces.get(code);

  if (!space) {
    return callback(null, {
      success: false,
      message: `El espacio "${code}" no existe.`,
      config:  null,
    });
  }

  callback(null, {
    success: true,
    message: "Configuración obtenida.",
    config:  space.config,
  });
}

// ── Inicio del servidor gRPC ─────────────────────────────────
function main() {
  const server = new grpc.Server();

  server.addService(teamspace.UserSpaceService.service, {
    CreateSpace:    createSpace,
    JoinSpace:      joinSpace,
    GetSpaceMembers: getSpaceMembers,
    GetSpaceConfig: getSpaceConfig,
  });

  // 0.0.0.0 → escucha en todas las interfaces de red locales
  const bindAddr = "0.0.0.0:50051";

  server.bindAsync(bindAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error("[ERROR] No se pudo iniciar el servidor:", err.message);
      process.exit(1);
    }
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  MÁQUINA 1 — Servicio de Usuarios y Espacios ║");
    console.log(`║  gRPC escuchando en ${bindAddr}          ║`);
    console.log("╚══════════════════════════════════════════════╝");
  });
}

main();
