import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Logger } from 'nestjs-pino';
import { ResendEmailProvider } from '../email/resend-email.provider';
import { SmtpEmailProvider } from '../email/smtp-email.provider';
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
}
