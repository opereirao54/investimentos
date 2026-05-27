## Resumo

<!-- O que muda e por quê (1-3 frases). Foque no porquê, não no o quê. -->

## Tipo

- [ ] feat (nova funcionalidade)
- [ ] fix (correção de bug)
- [ ] refactor (sem alterar comportamento)
- [ ] test (testes)
- [ ] chore (deps, infra, build)
- [ ] docs

## Test plan

<!-- Comandos rodados localmente. Risco/impacto: produção, billing, auth, etc. -->

- [ ] `npm run lint` (0 erros)
- [ ] `npm test` (58/58)
- [ ] `npm run test:flows` (108/108)
- [ ] `npm run build` (verde)
- [ ] Preview deploy validado em browser:
  - [ ] `/` carrega landing
  - [ ] `/app` faz login + dashboard
  - [ ] Sem ReferenceError em DevTools
  - [ ] Feature alterada testada manualmente

## Mudanças em variáveis de ambiente

<!-- Lista qualquer env var nova ou alterada. Atualize .env.example. -->

- [ ] N/A
- [ ] Documentadas em `.env.example` e `README.md`

## Restrições do projeto respeitadas

- [ ] Não adicionei novos endpoints `/api/` (cap de 12 Vercel Hobby)
- [ ] Top-level em classic scripts é `var`, não `let`/`const`
- [ ] Onclick handlers do HTML continuam funcionando (globais preservados)
