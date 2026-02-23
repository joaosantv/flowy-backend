-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profissional" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "codigoVerificacao" TEXT,
    "contaVerificada" BOOLEAN NOT NULL DEFAULT false,
    "nomeSalao" TEXT,
    "telefone" TEXT,
    "instagram" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Profissional" ("criadoEm", "email", "id", "instagram", "nome", "nomeSalao", "senha", "telefone") SELECT "criadoEm", "email", "id", "instagram", "nome", "nomeSalao", "senha", "telefone" FROM "Profissional";
DROP TABLE "Profissional";
ALTER TABLE "new_Profissional" RENAME TO "Profissional";
CREATE UNIQUE INDEX "Profissional_email_key" ON "Profissional"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
