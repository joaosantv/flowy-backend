require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5500';
const CODE_TTL_MS = 15 * 60 * 1000;
const allowedOrigins = new Set(FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean));

if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('gere-uma-chave')) throw new Error('JWT_SECRET deve ser uma chave aleatória com ao menos 32 caracteres.');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida pelo CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400
}));
app.use(express.json({ limit: '100kb' }));

const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' } });
const emailLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas solicitações. Tente novamente em alguns minutos.' } });
const bookingLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { erro: 'Muitas solicitações. Tente novamente em alguns minutos.' } });

const transporter = process.env.EMAIL_USER && process.env.EMAIL_PASS
  ? nodemailer.createTransport({ service: process.env.EMAIL_SERVICE || 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

const publicUser = (user) => ({ id: user.id, nome: user.nome, email: user.email, nomeSalao: user.nomeSalao, telefone: user.telefone, instagram: user.instagram });
const signToken = (user) => jwt.sign({ sub: user.id, nome: user.nome, email: user.email, nomeSalao: user.nomeSalao, telefone: user.telefone, instagram: user.instagram }, JWT_SECRET, { expiresIn: '7d' });
const emailIsValid = (email) => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const passwordIsValid = (password) => typeof password === 'string' && password.length >= 8 && password.length <= 128;
const codeIsValid = (code) => typeof code === 'string' && /^\d{6}$/.test(code);
const parseService = ({ nome, preco, duracaoMinutos }) => {
  const price = Number(preco); const duration = Number(duracaoMinutos);
  if (!nome?.trim() || nome.trim().length > 80 || !Number.isFinite(price) || price < 0 || price > 100000 || !Number.isInteger(duration) || duration <= 0 || duration > 1440) return null;
  return { nome: nome.trim(), preco: price, duracaoMinutos: duration };
};
const authenticate = (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ erro: 'Autenticação necessária.' });
  try { req.profissionalId = jwt.verify(token, JWT_SECRET).sub; return next(); }
  catch { return res.status(401).json({ erro: 'Sessão inválida ou expirada. Entre novamente.' }); }
};
const sendCodeEmail = async (user, code, subject) => {
  if (!transporter) throw new Error('E-mail não configurado. Defina EMAIL_USER e EMAIL_PASS.');
  await transporter.sendMail({ from: process.env.EMAIL_FROM || `Flowy <${process.env.EMAIL_USER}>`, to: user.email, subject, text: `Olá, ${user.nome}! Seu código Flowy é ${code}. Ele expira em 15 minutos.` });
};

app.get('/', (_req, res) => res.json({ mensagem: 'A API do Flowy está funcionando.' }));

app.post('/api/cadastro', authLimiter, async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome?.trim() || nome.trim().length > 100 || !emailIsValid(email?.trim()) || !passwordIsValid(senha)) return res.status(400).json({ erro: 'Informe nome, e-mail válido e uma senha de 8 a 128 caracteres.' });
    if (await prisma.profissional.findUnique({ where: { email: email.trim().toLowerCase() } })) return res.status(400).json({ erro: 'E-mail já cadastrado.' });
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const usuario = await prisma.profissional.create({ data: { nome: nome.trim(), email: email.trim().toLowerCase(), senha: await bcrypt.hash(senha, 12), codigoVerificacao: await bcrypt.hash(codigo, 12), codigoExpiraEm: new Date(Date.now() + CODE_TTL_MS) } });
    try { await sendCodeEmail(usuario, codigo, 'Seu código de verificação - Flowy'); }
    catch (error) { await prisma.profissional.delete({ where: { id: usuario.id } }); console.error('Falha no envio de e-mail:', error); return res.status(503).json({ erro: 'Não foi possível enviar o e-mail de verificação. Tente novamente.' }); }
    return res.status(201).json({ mensagem: 'Código enviado para seu e-mail.', idUsuario: usuario.id });
  } catch (error) { console.error(error); return res.status(500).json({ erro: 'Erro interno no servidor.' }); }
});

app.post('/api/verificar-codigo', authLimiter, async (req, res) => {
  try {
    const { idUsuario, codigoDigitado } = req.body;
    const usuario = await prisma.profissional.findUnique({ where: { id: idUsuario } });
    if (!usuario || !codeIsValid(codigoDigitado) || !usuario.codigoExpiraEm || usuario.codigoExpiraEm < new Date() || !(await bcrypt.compare(codigoDigitado, usuario.codigoVerificacao || ''))) return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    const verified = await prisma.profissional.update({ where: { id: usuario.id }, data: { contaVerificada: true, codigoVerificacao: null, codigoExpiraEm: null } });
    return res.json({ mensagem: 'Conta ativada com sucesso.', token: signToken(verified), usuario: publicUser(verified) });
  } catch (error) { console.error(error); return res.status(500).json({ erro: 'Erro ao validar o código.' }); }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await prisma.profissional.findUnique({ where: { email: email?.trim().toLowerCase() || '' } });
    if (!usuario || !(await bcrypt.compare(senha || '', usuario.senha))) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    if (!usuario.contaVerificada) return res.status(403).json({ erro: 'Sua conta ainda não foi verificada.' });
    return res.json({ mensagem: 'Login realizado com sucesso.', token: signToken(usuario), usuario: publicUser(usuario) });
  } catch (error) { console.error(error); return res.status(500).json({ erro: 'Erro interno ao tentar entrar.' }); }
});

app.post('/api/esqueci-senha', emailLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    if (!emailIsValid(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    const usuario = await prisma.profissional.findUnique({ where: { email } });
    if (!usuario) return res.json({ mensagem: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.' });
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const updated = await prisma.profissional.update({ where: { id: usuario.id }, data: { codigoVerificacao: await bcrypt.hash(codigo, 12), codigoExpiraEm: new Date(Date.now() + CODE_TTL_MS) } });
    try { await sendCodeEmail(updated, codigo, 'Recuperação de senha - Flowy'); }
    catch (error) { console.error(error); return res.status(503).json({ erro: 'Não foi possível enviar o e-mail de recuperação.' }); }
    return res.json({ mensagem: 'Código enviado para seu e-mail.' });
  } catch (error) { console.error(error); return res.status(500).json({ erro: 'Erro ao processar a recuperação.' }); }
});

app.post('/api/redefinir-senha', authLimiter, async (req, res) => {
  try {
    const { email, codigo, novaSenha } = req.body;
    if (!passwordIsValid(novaSenha)) return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' });
    const usuario = await prisma.profissional.findUnique({ where: { email: email?.trim().toLowerCase() || '' } });
    if (!usuario || !codeIsValid(codigo) || !usuario.codigoExpiraEm || usuario.codigoExpiraEm < new Date() || !(await bcrypt.compare(codigo, usuario.codigoVerificacao || ''))) return res.status(400).json({ erro: 'Código inválido ou expirado.' });
    await prisma.profissional.update({ where: { id: usuario.id }, data: { senha: await bcrypt.hash(novaSenha, 12), codigoVerificacao: null, codigoExpiraEm: null } });
    return res.json({ mensagem: 'Senha redefinida com sucesso.' });
  } catch (error) { console.error(error); return res.status(500).json({ erro: 'Erro ao salvar a nova senha.' }); }
});

app.use('/api/setup', authenticate);
app.use('/api/servicos', (req, res, next) => req.method === 'GET' && req.path.startsWith('/public') ? next() : authenticate(req, res, next));
app.use('/api/clientes', authenticate);
app.use('/api/financeiro', authenticate);
app.use('/api/agenda', authenticate);

app.put('/api/setup/:id', async (req, res) => {
  try {
    const { nomeSalao, telefone, instagram } = req.body;
    if (!nomeSalao?.trim() || !telefone?.trim()) return res.status(400).json({ erro: 'Nome do salão e telefone são obrigatórios.' });
    const usuario = await prisma.profissional.update({ where: { id: req.profissionalId }, data: { nomeSalao: nomeSalao.trim(), telefone: telefone.trim(), instagram: instagram?.trim() || null } });
    return res.json({ mensagem: 'Dados salvos.', token: signToken(usuario), usuario: publicUser(usuario) });
  } catch (error) { console.error(error); return res.status(500).json({ erro: 'Erro ao salvar os dados.' }); }
});

app.post('/api/servicos', async (req, res) => { try { const service = parseService(req.body); if (!service) return res.status(400).json({ erro: 'Dados do serviço inválidos.' }); const servico = await prisma.servico.create({ data: { ...service, profissionalId: req.profissionalId } }); return res.status(201).json({ mensagem: 'Serviço criado.', servico }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao salvar o serviço.' }); } });
app.get('/api/servicos/:profissionalId', async (req, res) => { try { return res.json(await prisma.servico.findMany({ where: { profissionalId: req.profissionalId } })); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao carregar os serviços.' }); } });
app.put('/api/servicos/:id', async (req, res) => { try { const service = parseService(req.body); if (!service) return res.status(400).json({ erro: 'Dados do serviço inválidos.' }); const result = await prisma.servico.updateMany({ where: { id: req.params.id, profissionalId: req.profissionalId }, data: service }); if (!result.count) return res.status(404).json({ erro: 'Serviço não encontrado.' }); return res.json({ mensagem: 'Serviço atualizado.' }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao atualizar o serviço.' }); } });
app.delete('/api/servicos/:id', async (req, res) => { try { const result = await prisma.servico.deleteMany({ where: { id: req.params.id, profissionalId: req.profissionalId } }); if (!result.count) return res.status(404).json({ erro: 'Serviço não encontrado.' }); return res.json({ mensagem: 'Serviço excluído.' }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao excluir o serviço.' }); } });

app.get('/api/vitrine/:id', async (req, res) => { try { const profissional = await prisma.profissional.findUnique({ where: { id: req.params.id }, select: { id: true, nome: true, nomeSalao: true, telefone: true, instagram: true, servicos: true } }); return profissional ? res.json(profissional) : res.status(404).json({ erro: 'Profissional não encontrado.' }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao carregar a vitrine.' }); } });
app.get('/api/servico/:id', async (req, res) => { try { const servico = await prisma.servico.findUnique({ where: { id: req.params.id } }); return servico ? res.json(servico) : res.status(404).json({ erro: 'Serviço não encontrado.' }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao carregar o serviço.' }); } });
app.get('/api/agendamentos/:profissionalId', async (req, res) => { try { return res.json(await prisma.agendamento.findMany({ where: { profissionalId: req.params.profissionalId, status: { not: 'CANCELADO' } }, select: { dataHora: true } })); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao buscar horários.' }); } });
app.post('/api/agendamentos', bookingLimiter, async (req, res) => { try { const { dataHora, nomeCliente, telefoneCliente, servicoId, profissionalId } = req.body; const date = new Date(dataHora); const telefoneLimpo = String(telefoneCliente || '').replace(/\D/g, ''); if (!nomeCliente?.trim() || nomeCliente.trim().length > 100 || telefoneLimpo.length < 10 || telefoneLimpo.length > 15 || Number.isNaN(date.valueOf()) || date < new Date()) return res.status(400).json({ erro: 'Dados do agendamento inválidos.' }); const servico = await prisma.servico.findFirst({ where: { id: servicoId, profissionalId } }); if (!servico) return res.status(400).json({ erro: 'Serviço inválido.' }); const exists = await prisma.agendamento.findFirst({ where: { profissionalId, dataHora: date, status: { not: 'CANCELADO' } } }); if (exists) return res.status(409).json({ erro: 'Este horário acabou de ser reservado. Escolha outro.' }); const agendamento = await prisma.agendamento.create({ data: { dataHora: date, nomeCliente: nomeCliente.trim(), telefoneCliente: telefoneLimpo, servicoId, profissionalId } }); return res.status(201).json({ mensagem: 'Agendado com sucesso.', agendamento }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao salvar o agendamento.' }); } });

app.get('/api/clientes/:profissionalId', async (req, res) => { try { const agendamentos = await prisma.agendamento.findMany({ where: { profissionalId: req.profissionalId }, include: { servico: true }, orderBy: { dataHora: 'desc' } }); const clientes = Object.values(agendamentos.reduce((map, ag) => { const key = ag.telefoneCliente; map[key] ||= { nome: ag.nomeCliente, telefone: key, visitas: 0, historico: [] }; map[key].visitas++; map[key].historico.push({ data: ag.dataHora, servicoNome: ag.servico.nome, preco: ag.servico.preco }); return map; }, {})); return res.json(clientes); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao carregar clientes.' }); } });
app.get('/api/agenda/:profissionalId', async (req, res) => { try { return res.json(await prisma.agendamento.findMany({ where: { profissionalId: req.profissionalId, status: { not: 'CANCELADO' } }, include: { servico: true }, orderBy: { dataHora: 'asc' } })); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao carregar a agenda.' }); } });
app.put('/api/agenda/:id/status', async (req, res) => { try { const status = String(req.body.status || '').toUpperCase(); if (!['PENDENTE', 'CONFIRMADO', 'CONCLUIDO', 'CANCELADO'].includes(status)) return res.status(400).json({ erro: 'Status inválido.' }); const result = await prisma.agendamento.updateMany({ where: { id: req.params.id, profissionalId: req.profissionalId }, data: { status } }); if (!result.count) return res.status(404).json({ erro: 'Agendamento não encontrado.' }); return res.json({ mensagem: 'Status do agendamento atualizado.' }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao atualizar o agendamento.' }); } });
app.get('/api/financeiro/:profissionalId', async (req, res) => { try { const agendamentos = await prisma.agendamento.findMany({ where: { profissionalId: req.profissionalId, status: { not: 'CANCELADO' } }, include: { servico: true }, orderBy: { dataHora: 'desc' } }); const now = new Date(); const values = [0, 0, 0, 0, 0, 0, 0]; let faturamentoMes = 0; const ultimosPagamentos = []; for (const ag of agendamentos) { const date = new Date(ag.dataHora); if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) { faturamentoMes += ag.servico.preco; values[date.getDay()] += ag.servico.preco; } if (ultimosPagamentos.length < 5) ultimosPagamentos.push({ nomeCliente: ag.nomeCliente, servicoNome: ag.servico.nome, preco: ag.servico.preco, dataHora: ag.dataHora }); } const max = Math.max(...values, 1); return res.json({ faturamentoMes, ultimosPagamentos, grafico: values.map((value) => value / max * 100) }); } catch (e) { console.error(e); return res.status(500).json({ erro: 'Erro ao calcular os dados financeiros.' }); } });

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ erro: 'Erro interno no servidor.' }); });
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
