import { BadGatewayException, Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Permission } from './auth';
import { ok, parse } from './core';
@ApiTags('Endereços') @ApiBearerAuth() @Controller('addresses')
export class AddressController {
  @Get(':cep') @Permission('employees.view_personal')
  async lookup(@Param('cep') raw: string) {
    const cep = parse(z.string().regex(/^\d{8}$/,'CEP deve conter oito dígitos.'), raw);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {signal:AbortSignal.timeout(5000)});
      if(!response.ok) throw new Error('CEP indisponível');
      const data = await response.json() as Record<string, string | boolean>;
      if(data.erro) throw new Error('CEP não localizado');
      return ok({street:data.logradouro,district:data.bairro,city:data.localidade,state:data.uf});
    } catch { throw new BadGatewayException('Não foi possível localizar o CEP. Preencha o endereço manualmente.'); }
  }
}
