import { repl } from '@nestjs/core';
import { FilterModule } from './nest';

async function bootstrap() {
  await repl(FilterModule.forRoot());
}
bootstrap();
