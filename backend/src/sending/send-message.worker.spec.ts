import { Worker } from 'bullmq';
import { sendMessageQueueName } from './send-message.queue';
import { SendMessageWorker } from './send-message.worker';

/**
 * `bullmq.Worker` é mockado por completo — estes testes cobrem só a lógica
 * de orquestração de `SendMessageWorker` (1 Worker por sessão, idempotência
 * de `ensureWorker`, e a decisão de `handleFailed` sobre quando uma falha é
 * definitiva), nunca conexão Redis de verdade. `getRedisConnectionOptions`
 * também é mockado porque lança se `REDIS_URL` não estiver setado no
 * ambiente de teste.
 */
jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../queue/redis-connection', () => ({ getRedisConnectionOptions: jest.fn(() => ({})) }));

const MockedWorker = Worker as unknown as jest.Mock;

/**
 * O listener registrado via `worker.on('failed', (job, err) => { void
 * this.handleFailed(job, err); })` dispara `handleFailed` em fire-and-forget
 * (não devolve a Promise para o BullMQ) — então, depois de invocar o
 * handler nos testes, é preciso esvaziar a fila de microtasks antes de
 * inspecionar efeitos que só acontecem depois do primeiro `await` interno
 * (ex.: o `catch` do `finalizeFailure` rejeitado).
 */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('SendMessageWorker', () => {
  function buildService(env: Record<string, unknown> = {}) {
    const instances: Array<{ handlers: Record<string, (...args: unknown[]) => void>; close: jest.Mock }> = [];

    MockedWorker.mockImplementation(() => {
      const instance = {
        handlers: {} as Record<string, (...args: unknown[]) => void>,
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
          instance.handlers[event] = handler;
        }),
        close: jest.fn(async () => undefined),
      };
      instances.push(instance);
      return instance;
    });

    const processor = { process: jest.fn(async () => undefined), finalizeFailure: jest.fn(async () => undefined) };
    const config = { get: jest.fn((key: string) => env[key]) };
    const logger = { error: jest.fn() };

    const worker = new SendMessageWorker(processor as never, config as never, logger as never);
    return { worker, processor, config, logger, instances };
  }

  afterEach(() => {
    MockedWorker.mockReset();
  });

  describe('ensureWorker', () => {
    it('cria um Worker BullMQ para a fila da sessão', () => {
      const { worker, instances } = buildService();

      worker.ensureWorker('session-1');

      expect(MockedWorker).toHaveBeenCalledTimes(1);
      expect(MockedWorker.mock.calls[0][0]).toBe(sendMessageQueueName('session-1'));
      expect(instances).toHaveLength(1);
    });

    it('é idempotente: chamar de novo para a mesma sessão não cria outro Worker', () => {
      const { worker } = buildService();

      worker.ensureWorker('session-1');
      worker.ensureWorker('session-1');

      expect(MockedWorker).toHaveBeenCalledTimes(1);
    });

    it('cria um Worker separado por sessão diferente', () => {
      const { worker } = buildService();

      worker.ensureWorker('session-1');
      worker.ensureWorker('session-2');

      expect(MockedWorker).toHaveBeenCalledTimes(2);
    });

    it('delega cada job recebido para processor.process(job.data)', async () => {
      const { worker, processor } = buildService();

      worker.ensureWorker('session-1');
      const processorFn = MockedWorker.mock.calls[0][1] as (job: { data: unknown }) => Promise<void>;
      const data = { envioId: 'envio-9', userId: 'user-1', sessionId: 'session-1' };
      await processorFn({ data });

      expect(processor.process).toHaveBeenCalledWith(data);
    });
  });

  describe('handleFailed (listener "failed" do Worker BullMQ)', () => {
    const jobData = { envioId: 'envio-1', userId: 'user-1', sessionId: 'session-1' };

    it('não finaliza quando ainda restam tentativas (attemptsMade < attempts configurado)', async () => {
      const { worker, processor, instances } = buildService();
      worker.ensureWorker('session-1');

      const job = { data: jobData, attemptsMade: 2, opts: { attempts: 5 } };
      await instances[0].handlers.failed(job, new Error('falha transitória'));

      expect(processor.finalizeFailure).not.toHaveBeenCalled();
    });

    it('finaliza (FALHOU definitivo) quando attemptsMade atinge o attempts configurado no job', async () => {
      const { worker, processor, instances } = buildService();
      worker.ensureWorker('session-1');

      const err = new Error('esgotou tentativas');
      const job = { data: jobData, attemptsMade: 5, opts: { attempts: 5 } };
      await instances[0].handlers.failed(job, err);

      expect(processor.finalizeFailure).toHaveBeenCalledWith(jobData, 5, err);
    });

    it('usa SEND_MAX_ATTEMPTS como fallback quando o job não tem opts.attempts', async () => {
      const { worker, processor, instances } = buildService({ SEND_MAX_ATTEMPTS: 3 });
      worker.ensureWorker('session-1');

      const job = { data: jobData, attemptsMade: 3, opts: {} };
      await instances[0].handlers.failed(job, new Error('x'));

      expect(processor.finalizeFailure).toHaveBeenCalledWith(jobData, 3, expect.any(Error));
    });

    it('não quebra quando o job vem undefined (BullMQ pode emitir "failed" sem job em cenários raros)', async () => {
      const { worker, processor, instances } = buildService();
      worker.ensureWorker('session-1');

      await expect(instances[0].handlers.failed(undefined, new Error('x'))).resolves.toBeUndefined();
      expect(processor.finalizeFailure).not.toHaveBeenCalled();
    });

    it('loga o erro (sem relançar) quando finalizeFailure falha', async () => {
      const { worker, processor, logger, instances } = buildService();
      worker.ensureWorker('session-1');
      processor.finalizeFailure.mockRejectedValueOnce(new Error('erro ao gravar no banco'));

      const job = { data: jobData, attemptsMade: 5, opts: { attempts: 5 } };
      instances[0].handlers.failed(job, new Error('original'));
      await flushPromises();
      await flushPromises();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'send_message_finalize_failure_error', envioId: 'envio-1' }),
        expect.any(String),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('fecha todos os Workers criados', async () => {
      const { worker, instances } = buildService();
      worker.ensureWorker('session-1');
      worker.ensureWorker('session-2');

      await worker.onModuleDestroy();

      expect(instances[0].close).toHaveBeenCalled();
      expect(instances[1].close).toHaveBeenCalled();
    });
  });
});
