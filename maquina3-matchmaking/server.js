/**
 * ═══════════════════════════════════════════════════════════════
 *  MÁQUINA 3 — Microservicio de Matchmaking
 *  Servidor gRPC  |  Puerto 50052
 *
 *  Responsabilidades:
 *    • Algoritmo RANDOM: barajado Fisher-Yates
 *    • Algoritmo ORDER:  segmentación secuencial balanceada
 *    • División equitativa respetando el máximo por equipo
 *
 *  IP de escucha: 0.0.0.0:50052  (acepta toda la red local)
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

const path   = require("path");
const grpc   = require("@grpc/grpc-js");
const loader = require("@grpc/proto-loader");

// ── Carga del archivo proto ──────────────────────────────────
const PROTO_PATH = path.join(__dirname, "..", "proto", "teamspace.proto");

const packageDef = loader.loadSync(PROTO_PATH, {
  keepCase:  true,
  longs:     String,
  enums:     String,
  defaults:  true,
  oneofs:    true,
});

const protoDescriptor = grpc.loadPackageDefinition(packageDef);
const teamspace       = protoDescriptor.teamspace;

// ── Algoritmos de agrupación ─────────────────────────────────

/**
 * Fisher-Yates shuffle — O(n), in-place.
 * Mezcla el array de forma aleatoria e imparcial.
 * @param {Array} arr
 * @returns {Array} El mismo array mezclado
 */
function fisherYatesShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Segmentación equitativa.
 * Dado un array ordenado y un máximo por equipo,
 * calcula el número mínimo de equipos necesarios y
 * distribuye los alumnos de forma balanceada (los primeros
 * equipos reciben un alumno extra si la división no es exacta).
 *
 * Ejemplo: 10 alumnos, max 3 → 4 equipos: [3, 3, 2, 2]
 *
 * @param {Array}  students  - Array de Student ya ordenado
 * @param {number} maxPerTeam
 * @returns {Team[]}
 */
function segmentStudents(students, maxPerTeam) {
  const total      = students.length;
  const numTeams   = Math.ceil(total / maxPerTeam);
  const baseSize   = Math.floor(total / numTeams);
  const remainder  = total % numTeams; // Primeros `remainder` equipos tienen un alumno extra

  const teams = [];
  let cursor  = 0;

  for (let t = 0; t < numTeams; t++) {
    const size = t < remainder ? baseSize + 1 : baseSize;
    teams.push({
      team_number: t + 1,
      members:     students.slice(cursor, cursor + size),
    });
    cursor += size;
  }

  return teams;
}

// ── Handler gRPC ─────────────────────────────────────────────

/**
 * AssignTeams — Punto de entrada principal del matchmaking.
 */
function assignTeams(call, callback) {
  const { students, max_per_team, algorithm } = call.request;

  if (!students || students.length === 0) {
    return callback(null, {
      success:        false,
      message:        "No hay alumnos para asignar.",
      teams:          [],
      total_teams:    0,
      total_students: 0,
    });
  }

  if (!max_per_team || max_per_team < 1) {
    return callback(null, {
      success:        false,
      message:        "El valor de max_per_team debe ser mayor a 0.",
      teams:          [],
      total_teams:    0,
      total_students: 0,
    });
  }

  // Clonar el array para no mutar el original
  let working = [...students];

  if (algorithm === "RANDOM") {
    // Barajado Fisher-Yates
    fisherYatesShuffle(working);
    console.log(`[~] Algoritmo RANDOM aplicado a ${working.length} alumnos.`);
  } else {
    // ORDER — ordenar por timestamp de ingreso (ascendente)
    working.sort((a, b) => {
      const ta = parseInt(a.joined_at, 10) || 0;
      const tb = parseInt(b.joined_at, 10) || 0;
      return ta - tb;
    });
    console.log(`[~] Algoritmo ORDER aplicado a ${working.length} alumnos.`);
  }

  const teams = segmentStudents(working, max_per_team);

  // Log de equipos
  teams.forEach(t => {
    const ids = t.members.map(m => m.student_id).join(", ");
    console.log(`   Equipo ${t.team_number}: [${ids}]`);
  });

  callback(null, {
    success:        true,
    message:        `${teams.length} equipo(s) formado(s) con algoritmo ${algorithm}.`,
    teams,
    total_teams:    teams.length,
    total_students: students.length,
  });
}

// ── Inicio del servidor gRPC ─────────────────────────────────
function main() {
  const server = new grpc.Server();

  server.addService(teamspace.MatchmakingService.service, {
    AssignTeams: assignTeams,
  });

  const bindAddr = "0.0.0.0:50052";

  server.bindAsync(bindAddr, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error("[ERROR] No se pudo iniciar el servidor:", err.message);
      process.exit(1);
    }
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  MÁQUINA 3 — Servicio de Matchmaking         ║");
    console.log(`║  gRPC escuchando en ${bindAddr}          ║`);
    console.log("╚══════════════════════════════════════════════╝");
  });
}

main();
