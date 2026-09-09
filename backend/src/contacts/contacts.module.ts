import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { PhoneNumberService } from './phone-number.service';
import { ValidateNumbersQueueService } from './validate-numbers.queue';
import { ValidateNumbersWorker } from './validate-numbers.worker';

/**
 * Etapa 13 (Motor de contatos e normalização de números — README raiz
 * §5/6/13). `WhatsAppModule` fornece `WhatsAppProvider` (checkNumbers) e
 * `SessionService` (getOrCreateSession/publishStats); produtor e consumidor
 * da fila `queue:validate-numbers` vivem os dois aqui porque o backend roda
 * como monolito num único processo hoje (ver app.module.ts) — nada impede
 * de mover `ValidateNumbersWorker` para um processo de worker separado mais
 * tarde (README §10) sem tocar em `ContactsService`/`ContactsController`.
 */
@Module({
  imports: [ConfigModule, JwtModule.register({}), WhatsAppModule],
  controllers: [ContactsController],
  providers: [PhoneNumberService, ValidateNumbersQueueService, ValidateNumbersWorker, ContactsService],
  exports: [ContactsService, PhoneNumberService],
})
export class ContactsModule {}
