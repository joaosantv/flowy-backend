const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer'); // Importando o carteiro!

// Inicializando as ferramentas
const app = express();
const prisma = new PrismaClient();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// CONFIGURAÇÃO DO E-MAIL (NODEMAILER)
// ==========================================
const enviadorDeEmail = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'SEU_EMAIL@gmail.com', // Substitua depois
        pass: 'SUA_SENHA_DE_APP'     // Substitua depois
    }
});

// ==========================================
// ROTAS DO SISTEMA
// ==========================================

app.get('/', (req, res) => {
    res.json({ mensagem: "A API do Flowy está rodando lisa! 🚀" });
});

// 1. Rota de CADASTRO (Com envio de código 2FA)
app.post('/api/cadastro', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;

        if (!nome || !email || !senha) return res.status(400).json({ erro: "Preencha tudo!" });

        const usuarioExistente = await prisma.profissional.findUnique({ where: { email: email } });
        if (usuarioExistente) return res.status(400).json({ erro: "E-mail já cadastrado!" });

        // Gera um código aleatório de 6 dígitos
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();

        // Salva o usuário com o código e como "Não Verificado" (false)
        const novoUsuario = await prisma.profissional.create({
            data: { 
                nome, 
                email, 
                senha, 
                codigoVerificacao: codigo,
                contaVerificada: false 
            }
        });

        // TENTA ENVIAR O E-MAIL
        try {
            await enviadorDeEmail.sendMail({
                from: 'Equipe Flowy <seuemail@gmail.com>',
                to: email,
                subject: 'Seu código de verificação - Flowy',
                text: `Olá ${nome}! Seu código de verificação é: ${codigo}`
            });
        } catch (erroEmail) {
            console.log("Aviso: E-mail não enviado (Falta configurar a senha do Gmail no código).");
        }

        // Imprime o código no seu terminal para você conseguir testar sem ter o Gmail configurado ainda!
        console.log(`\n🔑 CÓDIGO DO USUÁRIO ${nome}: ${codigo}\n`);

        res.status(201).json({ mensagem: "Código gerado!", idUsuario: novoUsuario.id });

    } catch (erro) {
        console.error("Erro no cadastro:", erro);
        res.status(500).json({ erro: "Erro interno no servidor." });
    }
});

// 1.5. Rota de VERIFICAÇÃO DO CÓDIGO
app.post('/api/verificar-codigo', async (req, res) => {
    try {
        const { idUsuario, codigoDigitado } = req.body;

        const usuario = await prisma.profissional.findUnique({ where: { id: idUsuario } });

        if (!usuario) return res.status(404).json({ erro: "Usuário não encontrado." });

        if (usuario.codigoVerificacao !== codigoDigitado) {
            return res.status(400).json({ erro: "Código inválido ou incorreto." });
        }

        // Atualiza a conta para Verificada e limpa o código
        const usuarioVerificado = await prisma.profissional.update({
            where: { id: idUsuario },
            data: { contaVerificada: true, codigoVerificacao: null }
        });

        res.status(200).json({ 
            mensagem: "Conta ativada com sucesso!", 
            usuario: { 
                id: usuarioVerificado.id, 
                nome: usuarioVerificado.nome, 
                email: usuarioVerificado.email,
                nomeSalao: usuarioVerificado.nomeSalao 
            }
        });

    } catch (erro) {
        console.error("Erro na verificação:", erro);
        res.status(500).json({ erro: "Erro ao validar o código." });
    }
});

// 2. Rota de SETUP
app.put('/api/setup/:id', async (req, res) => {
    try {
        const { nomeSalao, telefone, instagram } = req.body;
        const usuarioAtualizado = await prisma.profissional.update({
            where: { id: req.params.id },
            data: { nomeSalao, telefone, instagram }
        });
        res.status(200).json({ mensagem: "Setup concluído!", usuario: usuarioAtualizado });
    } catch (erro) {
        res.status(500).json({ erro: "Erro ao salvar os dados." });
    }
});

// 3. CADASTRAR NOVO SERVIÇO
app.post('/api/servicos', async (req, res) => {
    try {
        const { nome, preco, duracaoMinutos, profissionalId } = req.body;
        const novoServico = await prisma.servico.create({
            data: {
                nome: nome,
                preco: parseFloat(preco),
                duracaoMinutos: parseInt(duracaoMinutos),
                profissionalId: profissionalId 
            }
        });
        res.status(201).json({ mensagem: "Serviço criado com sucesso!", servico: novoServico });
    } catch (erro) {
        console.error("Erro ao criar serviço:", erro);
        res.status(500).json({ erro: "Erro ao salvar o serviço no banco." });
    }
});

// 4. BUSCAR OS SERVIÇOS DO DONO
app.get('/api/servicos/:profissionalId', async (req, res) => {
    try {
        const servicos = await prisma.servico.findMany({
            where: { profissionalId: req.params.profissionalId }
        });
        res.status(200).json(servicos);
    } catch (erro) {
        console.error("Erro ao buscar serviços:", erro);
        res.status(500).json({ erro: "Erro ao carregar a lista de serviços." });
    }
});

// 5. ATUALIZAR UM SERVIÇO (EDITAR)
app.put('/api/servicos/:id', async (req, res) => {
    try {
        const { nome, preco, duracaoMinutos } = req.body;
        
        const servicoAtualizado = await prisma.servico.update({
            where: { id: req.params.id },
            data: {
                nome: nome,
                preco: parseFloat(preco),
                duracaoMinutos: parseInt(duracaoMinutos)
            }
        });
        res.status(200).json({ mensagem: "Serviço atualizado!", servico: servicoAtualizado });
    } catch (erro) {
        console.error("Erro ao editar:", erro);
        res.status(500).json({ erro: "Erro ao atualizar o serviço." });
    }
});

// 6. DELETAR UM SERVIÇO
app.delete('/api/servicos/:id', async (req, res) => {
    try {
        await prisma.servico.delete({
            where: { id: req.params.id }
        });
        res.status(200).json({ mensagem: "Serviço deletado com sucesso!" });
    } catch (erro) {
        console.error("Erro ao deletar:", erro);
        res.status(500).json({ erro: "Erro ao deletar o serviço." });
    }
});

// 7. ROTA PÚBLICA (VITRINE DO CLIENTE)
app.get('/api/vitrine/:id', async (req, res) => {
    try {
        const profissional = await prisma.profissional.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                nome: true,
                nomeSalao: true,
                telefone: true,
                instagram: true,
                servicos: true 
            }
        });

        if (!profissional) {
            return res.status(404).json({ erro: "Profissional não encontrado." });
        }

        res.status(200).json(profissional);
    } catch (erro) {
        console.error("Erro na vitrine:", erro);
        res.status(500).json({ erro: "Erro ao carregar a página do profissional." });
    }
});

// 8. BUSCAR UM SERVIÇO ESPECÍFICO (Para mostrar na tela de checkout)
app.get('/api/servico/:id', async (req, res) => {
    try {
        const servico = await prisma.servico.findUnique({
            where: { id: req.params.id }
        });
        
        if (!servico) return res.status(404).json({ erro: "Serviço não encontrado." });
        
        res.status(200).json(servico);
    } catch (erro) {
        console.error("Erro ao buscar serviço:", erro);
        res.status(500).json({ erro: "Erro ao carregar o serviço." });
    }
});

// 9. CRIAR O AGENDAMENTO (Salvar a reserva no banco)
app.post('/api/agendamentos', async (req, res) => {
    try {
        const { dataHora, nomeCliente, telefoneCliente, servicoId, profissionalId } = req.body;

        if (!servicoId || !profissionalId) {
            return res.status(400).json({ erro: "Link inválido. Por favor, volte para a tela do salão e selecione o serviço novamente." });
        }

        const novoAgendamento = await prisma.agendamento.create({
            data: {
                dataHora: new Date(dataHora), 
                nomeCliente: nomeCliente,
                telefoneCliente: telefoneCliente,
                servicoId: servicoId, 
                profissionalId: profissionalId 
            }
        });

        res.status(201).json({ mensagem: "Agendado com sucesso!", agendamento: novoAgendamento });
    } catch (erro) {
        console.error("Erro ao criar agendamento:", erro);
        res.status(500).json({ erro: "Erro ao salvar seu horário. Tente novamente." });
    }
});

// 10. BUSCAR AGENDAMENTOS (Para bloquear horários ocupados na tela do cliente)
app.get('/api/agendamentos/:profissionalId', async (req, res) => {
    try {
        const agendamentos = await prisma.agendamento.findMany({
            where: { 
                profissionalId: req.params.profissionalId,
                status: { not: 'CANCELADO' } 
            },
            select: { dataHora: true } 
        });
        
        res.status(200).json(agendamentos);
    } catch (erro) {
        console.error("Erro ao buscar agendamentos:", erro);
        res.status(500).json({ erro: "Erro ao buscar horários ocupados." });
    }
});

// ==========================================
// ROTAS DE RECUPERAÇÃO DE SENHA
// ==========================================

// 11. ROTA DE ESQUECI A SENHA (Gera o código)
app.post('/api/esqueci-senha', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Procura se o e-mail existe no banco
        const usuario = await prisma.profissional.findUnique({ where: { email } });

        if (!usuario) {
            return res.status(404).json({ erro: "E-mail não encontrado no sistema." });
        }

        // Gera um código de 6 dígitos novo
        const codigo = Math.floor(100000 + Math.random() * 900000).toString();

        // Salva esse código na gaveta do usuário
        await prisma.profissional.update({
            where: { email },
            data: { codigoVerificacao: codigo }
        });

        // Imprime no terminal para você testar
        console.log(`\n🆘 CÓDIGO DE RECUPERAÇÃO PARA ${usuario.nome}: ${codigo}\n`);

        res.status(200).json({ mensagem: "Código gerado com sucesso!" });
    } catch (erro) {
        console.error("Erro na recuperação:", erro);
        res.status(500).json({ erro: "Erro ao processar a recuperação." });
    }
});

// 12. ROTA DE REDEFINIR SENHA (Salva a senha nova)
app.post('/api/redefinir-senha', async (req, res) => {
    try {
        const { email, codigo, novaSenha } = req.body;
        
        const usuario = await prisma.profissional.findUnique({ where: { email } });

        // Verifica se o usuário existe e se o código que ele digitou é o mesmo do banco
        if (!usuario || usuario.codigoVerificacao !== codigo) {
            return res.status(400).json({ erro: "Código inválido ou incorreto." });
        }

        // Se bater, atualiza a senha e APAGA o código por segurança
        await prisma.profissional.update({
            where: { email },
            data: { 
                senha: novaSenha,
                codigoVerificacao: null 
            }
        });

        res.status(200).json({ mensagem: "Senha redefinida com sucesso!" });
    } catch (erro) {
        console.error("Erro ao redefinir:", erro);
        res.status(500).json({ erro: "Erro ao salvar a nova senha." });
    }
});

// ==========================================
// ROTA DE LOGIN
// ==========================================

// 13. ENTRAR NO SISTEMA
app.post('/api/login', async (req, res) => {
    try {
        const { email, senha } = req.body;

        // 1. Procura o usuário pelo e-mail
        const usuario = await prisma.profissional.findUnique({ where: { email } });

        // 2. Se não achar o e-mail ou a senha não bater, barra a entrada
        if (!usuario || usuario.senha !== senha) {
            return res.status(401).json({ erro: "E-mail ou senha incorretos." });
        }

        // 3. (Opcional) Verifica se a conta já foi validada com o código de 6 dígitos
        if (usuario.contaVerificada === false) {
            return res.status(403).json({ erro: "Sua conta ainda não foi verificada. Volte no cadastro e insira o código." });
        }

        // 4. Se passou em tudo, devolve os dados para o navegador salvar a "sessão"
        res.status(200).json({
            mensagem: "Login realizado com sucesso!",
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                nomeSalao: usuario.nomeSalao,
                telefone: usuario.telefone,
                instagram: usuario.instagram
            }
        });

    } catch (erro) {
        console.error("Erro no login:", erro);
        res.status(500).json({ erro: "Erro interno no servidor ao tentar logar." });
    }
});

// 14. LISTAR CLIENTES E SEU HISTÓRICO
app.get('/api/clientes/:profissionalId', async (req, res) => {
    try {
        // Puxa todos os agendamentos do salão (trazendo os detalhes do serviço junto)
        const agendamentos = await prisma.agendamento.findMany({
            where: { profissionalId: req.params.profissionalId },
            include: { servico: true },
            orderBy: { dataHora: 'desc' } // Os mais recentes primeiro
        });

        // Agrupa os agendamentos usando o telefone do cliente como "identidade"
        const clientesMap = {};

        agendamentos.forEach(ag => {
            const tel = ag.telefoneCliente;
            
            // Se o cliente ainda não tá na lista, cria a ficha dele
            if (!clientesMap[tel]) {
                clientesMap[tel] = {
                    nome: ag.nomeCliente,
                    telefone: tel,
                    visitas: 0,
                    historico: []
                };
            }
            
            // Adiciona a visita no histórico dele
            clientesMap[tel].visitas += 1;
            clientesMap[tel].historico.push({
                data: ag.dataHora,
                servicoNome: ag.servico.nome,
                preco: ag.servico.preco
            });
        });

        // Transforma a lista agrupada em um array normal pro Front-end
        const listaClientes = Object.values(clientesMap);

        res.status(200).json(listaClientes);
    } catch (erro) {
        console.error("Erro ao buscar clientes:", erro);
        res.status(500).json({ erro: "Erro ao carregar a lista de clientes." });
    }
});

// ==========================================
// 15. ROTA DO FINANCEIRO (Faturamento e Gráficos)
// ==========================================
app.get('/api/financeiro/:profissionalId', async (req, res) => {
    try {
        // Puxa todos os agendamentos do salão (trazendo o preço do serviço junto)
        const agendamentos = await prisma.agendamento.findMany({
            where: { 
                profissionalId: req.params.profissionalId,
                status: { not: 'CANCELADO' } // Considera como receita tudo que não foi cancelado
            },
            include: { servico: true },
            orderBy: { dataHora: 'desc' }
        });

        // Pegamos o mês e o ano que estamos agora
        const dataAtual = new Date();
        const mesAtual = dataAtual.getMonth();
        const anoAtual = dataAtual.getFullYear();

        let faturamentoMes = 0;
        const ultimosPagamentos = [];
        const ganhosPorDiaSemana = [0, 0, 0, 0, 0, 0, 0]; // Domingo a Sábado

        agendamentos.forEach(ag => {
            const dataAg = new Date(ag.dataHora);
            const preco = ag.servico.preco;

            // 1. Calcula o faturamento apenas do mês atual
            if (dataAg.getMonth() === mesAtual && dataAg.getFullYear() === anoAtual) {
                faturamentoMes += preco;
                
                // 2. Separa o faturamento por dia da semana para o gráfico (0 = Dom, 1 = Seg...)
                const diaSemana = dataAg.getDay();
                ganhosPorDiaSemana[diaSemana] += preco;
            }

            // 3. Separa os últimos 5 agendamentos para a listinha de pagamentos
            if (ultimosPagamentos.length < 5) {
                ultimosPagamentos.push({
                    nomeCliente: ag.nomeCliente,
                    servicoNome: ag.servico.nome,
                    preco: preco,
                    dataHora: ag.dataHora
                });
            }
        });

        // 4. Calcula a porcentagem de cada barra do gráfico para o HTML conseguir desenhar!
        const maxGanho = Math.max(...ganhosPorDiaSemana) || 1; // Acha o dia que ganhou mais
        const graficoPorcentagem = ganhosPorDiaSemana.map(valor => (valor / maxGanho) * 100);

        res.status(200).json({
            faturamentoMes,
            ultimosPagamentos,
            grafico: graficoPorcentagem
        });

    } catch (erro) {
        console.error("Erro no financeiro:", erro);
        res.status(500).json({ erro: "Erro ao calcular os dados financeiros." });
    }
});

// ==========================================
// 16. ROTA DA AGENDA (Buscar todos os detalhes)
// ==========================================
app.get('/api/agenda/:profissionalId', async (req, res) => {
    try {
        // Traz TODOS os agendamentos ativos do profissional, do mais cedo pro mais tarde
        const agendamentos = await prisma.agendamento.findMany({
            where: { 
                profissionalId: req.params.profissionalId,
                status: { not: 'CANCELADO' }
            },
            include: {
                servico: true // O Prisma traz junto o nome do serviço, preço e duração!
            },
            orderBy: {
                dataHora: 'asc' // Ordem cronológica (09:00, 09:30, 10:00...)
            }
        });

        res.status(200).json(agendamentos);
    } catch (erro) {
        console.error("Erro na agenda:", erro);
        res.status(500).json({ erro: "Erro ao carregar a agenda." });
    }
});

// ==========================================
// LIGANDO O MOTOR (SEMPRE NO FINAL!)
// ==========================================
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});