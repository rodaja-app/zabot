import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { ResendEmailProvider } from '../email/resend-email.provider';
import { SmtpEmailProvider } from '../email/smtp-email.provider';
import { ProxyConfigService } from '../whatsapp/proxy-config.service';
import { WhatsAppDiagnosticsService } from '../whatsapp/whatsapp-diagnostics.service';
import { HealthService } from './health.service';

/**
 * `/health` — usado por Railway (healthcheck de deploy) e por monitoramento
 * externo. Verifica Postgres e Redis de verdade (via `HealthService`), não
 * só "processo de pé" — health check que sempre retorna 200 esconde exatamente
 * o tipo de falha que a regra de log robusto existe para pegar.
 *
 * A partir da etapa 17, `HealthService` também é consumido por
 * `AppInfoService` (módulo `settings`) para o card "Sobre" da Tela Menu —
 * este controller ficou só com a resposta HTTP/log, a checagem em si é
 * compartilhada.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly logger: Logger,
    private readonly smtp: SmtpEmailProvider,
    private readonly resend: ResendEmailProvider,
    private readonly proxyConfig: ProxyConfigService,
    private readonly whatsappDiagnostics: WhatsAppDiagnosticsService,
  ) {}

  @Get()
  async check(@Res() res: Response): Promise<void> {
    const { database, redis, healthy } = await this.health.check();

    if (!healthy) {
      this.logger.warn({ event: 'health_check_down', database, redis }, 'Health check falhou');
    }

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: healthy ? 'ok' : 'error',
      database,
      redis,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Diagnóstico de email acessível direto pelo navegador (celular ou PC) —
   * criado pra depurar a falha de envio de email do cadastro/reenvio de
   * código em produção sem precisar gerar um novo build do app só pra
   * reproduzir o erro. Testa a conexão/autenticação real do transporte
   * ativo — API HTTP do Resend se `RESEND_API_KEY`/`SMTP_PASSWORD` estiver
   * configurada pro Resend, senão `transporter.verify()` do nodemailer via
   * SMTP puro — sem mandar nenhum email de verdade em nenhum dos dois
   * casos. Nunca inclui senha/API key na resposta.
   */
  @Get('smtp')
  async checkSmtp(@Res() res: Response): Promise<void> {
    // Resend (API HTTP) tem prioridade sobre SMTP puro — ver email.module.ts.
    // Testa o transporte que está de fato ativo em produção, não sempre SMTP.
    const result = this.resend.configured ? await this.resend.verify() : await this.smtp.verify();

    if (!result.ok) {
      this.logger.warn({ event: 'smtp_diagnostic_failed', ...result }, 'Diagnóstico SMTP falhou');
    }

    res.status(result.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Diagnóstico de conexão WhatsApp acessível direto pelo navegador — criado
   * pra depurar "não conecta nem por QR nem por telefone" em produção sem
   * precisar gerar um build novo pra reproduzir. Cobre os dois pontos que
   * `BaileysWhatsAppProvider.startSession` precisa antes de sequer mostrar
   * QR/código: (1) conectividade real através do proxy DataImpulse — mesmo
   * teste (`ProxyConfigService.testConnectivity`) feito antes de abrir o
   * socket, mas aqui com um agent descartável, sem tocar em sessão real; e
   * (2) se o backend consegue buscar a versão mais recente do protocolo
   * WhatsApp Web (`fetchLatestBaileysVersion`) — sem isso, o Baileys usa uma
   * versão desatualizada embutida na lib e o handshake cai logo depois de
   * abrir (o padrão "conecta e cai por timeout" visto nos logs).
   */
  @Get('whatsapp')
  async checkWhatsapp(@Res() res: Response): Promise<void> {
    const proxyEnabled = this.proxyConfig.isEnabled;
    const proxyResult = proxyEnabled
      ? await (async () => {
          try {
            const agents = this.proxyConfig.buildTestAgents();
            return agents
              ? await this.proxyConfig.testConnectivity(agents)
              : { ok: false, error: 'proxy_agent_build_failed' };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        })()
      : { ok: true, error: undefined };

    let baileysVersion: { ok: boolean; version?: string; isLatest?: boolean; error?: string };
    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      baileysVersion = { ok: true, version: version.join('.'), isLatest };
    } catch (err) {
      baileysVersion = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const ok = proxyResult.ok && baileysVersion.ok;

    if (!ok) {
      this.logger.warn(
        { event: 'whatsapp_diagnostic_failed', proxyEnabled, proxyResult, baileysVersion },
        'Diagnóstico WhatsApp falhou',
      );
    }

    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      ok,
      proxy: { enabled: proxyEnabled, ...proxyResult },
      baileysVersion,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Diagnóstico de conexão WhatsApp PONTA A PONTA, acessível pelo navegador
   * — vai além de `GET /health/whatsapp` (que só testa proxy e versão do
   * protocolo): aqui é o handshake Baileys/Noise real através do proxy,
   * com credenciais efêmeras (nunca uma sessão de usuário, nunca tocam o
   * Postgres — ver `WhatsAppDiagnosticsService`). Criado porque
   * `/health/whatsapp` veio 100% saudável mesmo com a conexão de verdade
   * caindo com timeout — só um handshake de verdade revela a causa raiz.
   * Responde só depois de receber QR (prova que o handshake funcionou) ou a
   * conexão fechar com erro, ou 25s sem resposta — pode demorar a responder,
   * isso é esperado.
   */
  @Get('whatsapp-connect')
  async checkWhatsappConnect(@Res() res: Response): Promise<void> {
    const result = await this.whatsappDiagnostics.testLiveConnection();

    if (!result.ok) {
      this.logger.warn({ event: 'whatsapp_live_test_failed', ...result }, 'Diagnóstico de conexão WhatsApp ao vivo falhou');
    }

    res.status(result.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  }
}
