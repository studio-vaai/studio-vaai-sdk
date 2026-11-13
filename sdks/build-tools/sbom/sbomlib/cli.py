"""Command routing for the SDK-local inventory and release tools."""
import argparse
from importlib import import_module


COMMANDS = {
    name: ('sbomlib.inventory.cli', True)
    for name in ['rust', 'npm', 'prune-npm', 'artifact', 'bind-image']
} | {
    'native': ('sbomlib.inventory.native', False),
    'release': ('sbomlib.release.npm', False),
    'scan': ('sbomlib.scanning.runner', False),
}


def dispatch(commands, argv=None):
    parser = argparse.ArgumentParser(description='Generate and scan artifact-specific SBOMs.')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in commands:
        sub.add_parser(name, add_help=False)
    args, remaining = parser.parse_known_args(argv)
    module, preserve_command = commands[args.command]
    arguments = [*([args.command] if preserve_command else []), *remaining]
    return import_module(module).main(arguments)


def main(argv=None):
    return dispatch(COMMANDS, argv)
