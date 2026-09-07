"""Apaga todo lixo temporario (_verify_*, *.bak, *.disabled) deixado em
lib/ por etapas anteriores de verificacao.
Rodar da raiz do projeto ZaBot: python limpar_verify.py
"""

import os

# Qualquer arquivo dentro de lib/ cujo nome bata com um destes padroes
# e considerado lixo de verificacao e sera apagado.
PREFIXOS_LIXO = ("_verify_",)
SUFIXOS_LIXO = (".bak", ".disabled")


def eh_lixo(nome: str) -> bool:
    return nome.startswith(PREFIXOS_LIXO) or nome.endswith(SUFIXOS_LIXO)


def main():
    raiz = os.path.dirname(os.path.abspath(__file__))
    pasta_lib = os.path.join(raiz, "lib")

    encontrados = []
    for pasta_atual, _subpastas, arquivos in os.walk(pasta_lib):
        for nome in arquivos:
            if eh_lixo(nome):
                encontrados.append(os.path.join(pasta_atual, nome))

    if not encontrados:
        print("Nenhum arquivo de lixo encontrado. Tudo limpo.")
        return

    print(f"Encontrados {len(encontrados)} arquivo(s) para apagar:\n")
    for caminho in encontrados:
        print(f"  {os.path.relpath(caminho, raiz)}")

    apagados = 0
    print("\nApagando...")
    for caminho in encontrados:
        try:
            os.remove(caminho)
            print(f"Apagado: {os.path.relpath(caminho, raiz)}")
            apagados += 1
        except OSError as erro:
            print(f"Falhou ({erro}): {os.path.relpath(caminho, raiz)}")

    print(f"\nTotal apagado: {apagados}/{len(encontrados)}")


if __name__ == "__main__":
    main()
    input("\nPressione ENTER para fechar...")
