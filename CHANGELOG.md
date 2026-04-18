# Changelog - v0.0.4 (Pre-release)

## 🚀 Novidades e Melhorias
- **Modernização do Banco de Dados**: Refatoração completa do sistema de armazenamento do RSS para maior estabilidade. Removemos lógicas antigas de "tombstone" e otimizamos a gravação dos itens.
- **Super Performance**: Implementação de um sistema de cache de metadados que reduz drasticamente o uso de CPU durante a atualização e limpeza dos feeds.
- **Barra de Status Inteligente**: Agora você pode acompanhar em tempo real o progresso de salvamento, limpeza e verificação de duplicatas diretamente na barra de status do Obsidian.
- **Configurações Reorganizadas**: A aba de Configurações Gerais foi redesenhada para ser mais intuitiva, agrupando logicamente as opções de Atualização Automática, Remoção Automática e Armazenamento.
- **Deduplicação Veloz**: Substituímos escaneamentos redundantes no vault por buscas eficientes em memória ao marcar artigos duplicados.

## 🔧 Atualizações Técnicas
- **Update de Dependência**: Atualização do `defuddle` para a versão `0.17.0`, melhorando a extração de conteúdo de artigos.
- **Refatoração de Código**: Código mais limpo e modular, facilitando futuras manutenções e prevenindo bugs.

## 🐞 Correções
- Corrigido problema onde alguns itens de feed eram ignorados de forma inconsistente durante a importação.
- Melhoria na lógica de datas para garantir que novos artigos não sejam perdidos.
