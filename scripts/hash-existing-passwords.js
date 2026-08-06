require('dotenv').config();

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const alreadyHashed = (value) => /^\$2[aby]\$/.test(value || '');

async function main() {
  const usuarios = await prisma.profissional.findMany({ select: { id: true, senha: true, codigoVerificacao: true } });
  const antigos = usuarios.filter(({ senha }) => !alreadyHashed(senha));
  const codigosAntigos = usuarios.filter(({ codigoVerificacao }) => codigoVerificacao && !alreadyHashed(codigoVerificacao));

  for (const usuario of usuarios) {
    const data = {};
    if (!alreadyHashed(usuario.senha)) data.senha = await bcrypt.hash(usuario.senha, 12);
    if (usuario.codigoVerificacao && !alreadyHashed(usuario.codigoVerificacao)) data.codigoVerificacao = await bcrypt.hash(usuario.codigoVerificacao, 12);
    if (Object.keys(data).length) await prisma.profissional.update({ where: { id: usuario.id }, data });
  }

  console.log(`${antigos.length} senha(s) e ${codigosAntigos.length} código(s) antigo(s) convertidos para bcrypt.`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
