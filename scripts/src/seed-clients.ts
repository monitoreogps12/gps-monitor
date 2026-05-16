import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { clientsTable, clientVehiclesTable } from "../../lib/db/src/schema/clients";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const CLIENTS: Array<{
  name: string;
  phone: string;
  telegramId: string;
  vehicles: string[];
}> = [
  { name: "Rafael Contreras", phone: "+584261083671", telegramId: "7569627806", vehicles: ["1505", "1503", "1056"] },
  { name: "Eduardo Cordoba", phone: "+584247172512", telegramId: "8049782967", vehicles: ["1120", "1121"] },
  { name: "Wirnelia Montero", phone: "+584247250295", telegramId: "5764535026", vehicles: ["1560", "1569", "1558"] },
  { name: "Ricardo Martinez", phone: "+17864883243", telegramId: "8586814925", vehicles: ["1206", "1208"] },
  { name: "Chargon Vigia (Jean Carlos)", phone: "+584147113910", telegramId: "5959633153", vehicles: ["1540", "1539", "1538"] },
  { name: "Chargon P/C (Joy)", phone: "+584120383173", telegramId: "7633000375", vehicles: ["1303", "1554"] },
  { name: "Yvys Amparo", phone: "+584143734933", telegramId: "6486915033", vehicles: [] },
  { name: "Erie Molina", phone: "+584147237898", telegramId: "7366398950", vehicles: [] },
  { name: "Francisco Montilla", phone: "+584120299407", telegramId: "8632049145", vehicles: ["1508", "1507", "1506"] },
  { name: "Henry Zambrano", phone: "+584247649320", telegramId: "1498261798", vehicles: ["1449"] },
  { name: "Leidy Rojas", phone: "+584147388181", telegramId: "8487759873", vehicles: ["1636", "1246", "1248"] },
  { name: "Carlos Gomez", phone: "+584140822767", telegramId: "1112502481", vehicles: ["1578"] },
  { name: "Javier Jimenez", phone: "+584146323343", telegramId: "886993522", vehicles: ["1240"] },
  { name: "Jose Gerardo Perez Villa", phone: "+584247375141", telegramId: "8758964568", vehicles: ["1568"] },
  { name: "Jean Carlos Salcedo", phone: "+584147577240", telegramId: "1083366717", vehicles: ["1703", "1709", "1710"] },
  { name: "G/B Pérez Silen Pedro Luisve", phone: "+584248904487", telegramId: "318509172", vehicles: ["1681", "1689", "1695"] },
  { name: "Hidrobo González Orelio", phone: "+584247576788", telegramId: "1548416032", vehicles: ["1695"] },
  { name: "Juan Carlos Casaña Rivero", phone: "+584123093728", telegramId: "6983051856", vehicles: ["1511", "1590", "1067"] },
  { name: "Jose Ramirez", phone: "+18043998132", telegramId: "5871641669", vehicles: ["1684"] },
  { name: "Jose Duran", phone: "+584248199819", telegramId: "8513569881", vehicles: ["1668", "1253"] },
  { name: "Angel Moran", phone: "+584126152229", telegramId: "1729637285", vehicles: ["1590", "1511", "1070"] },
  { name: "C/J. Luis Ledezma", phone: "+584247069340", telegramId: "1654444448", vehicles: ["1168", "1513", "1155"] },
  { name: "Orlando Rangel", phone: "+584147560664", telegramId: "1137036638", vehicles: ["1434", "1429", "970"] },
  { name: "Ricardo Hernández", phone: "+584247439417", telegramId: "5483695324", vehicles: ["1280"] },
  { name: "Olinto Flores", phone: "+584147583683", telegramId: "1285867451", vehicles: ["1228", "1301", "993"] },
];

async function seed() {
  console.log("Seeding clients...");

  for (const c of CLIENTS) {
    const [client] = await db
      .insert(clientsTable)
      .values({
        name: c.name,
        phone: c.phone,
        telegramId: c.telegramId,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();

    if (!client) {
      console.log(`  Skipped (already exists): ${c.name}`);
      continue;
    }

    console.log(`  Created: ${c.name} (id=${client.id})`);

    for (const deviceId of c.vehicles) {
      await db
        .insert(clientVehiclesTable)
        .values({
          clientId: client.id,
          deviceId,
          deviceName: "",
          plate: "",
        })
        .onConflictDoNothing();
    }

    if (c.vehicles.length > 0) {
      console.log(`    -> ${c.vehicles.length} vehicles assigned`);
    }
  }

  console.log("Done seeding clients.");
  await pool.end();
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
