import { Injectable } from '@nestjs/common';
import {
  LogContext,
  getLogContext,
  runWithLogContext,
  setLogContext,
} from './request-context.store';

/**
 * Wrapper injetável em cima do singleton de `request-context.store` —
 * existe só pra ficar fácil de injetar/mockar em serviços e testes, sem
 * duplicar a lógica de contexto.
 */
@Injectable()
export class RequestContextService {
  run<T>(context: LogContext, fn: () => T): T {
    return runWithLogContext(context, fn);
  }

  set(patch: LogContext): void {
    setLogContext(patch);
  }

  getContext(): LogContext {
    return getLogContext();
  }
}
