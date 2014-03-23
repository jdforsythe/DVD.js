// Generate static JavaScript code from VM instructions.

'use strict';


import VM = require('../vm');
import utils = require('../utils');

var sprintf = utils.sprintf;

export = recompile;

function recompile(vm_commands) {
  var code = vm_commands.map(function(vm_command) {
    return recompileSingleCommand(vm_command);
  });

  return '  ' + code.join('\n  ');
}

function recompileSingleCommand(vm_command) {
  var command = vm_command.bytes.map(function(byte: number): string {
    return sprintf('%08i', (byte).toString(2));
  }).join('');

  var code = '';

  // Sample:
  //  { bytes: [ 48, 2, 0, 0, 0, 1, 0, 0 ] }
  //  001 1 00000000 0010 0000000000000000000000000 0000001 0000000000000000
  //    1 1        0    2                         0       1                0
  //  --- - -------- ---- ------------------------- ------- ----------------
  //  JumpTT 1

  //  011 1 00010000 0000000000000000000000000000000000000000000000000000

  switch (getbits(command, 63, 3)) {
    case 0: // Special instructions
      code += print_if_version_1(command);
      code += print_special_instruction(command);
      break;
    case 1: // Jump/Call or Link instructions
      if (getbits(command, 60, 1)) {
        code += print_if_version_2(command);
        code += print_jump_instruction(command);
      } else {
        code += print_if_version_1(command);
        code += print_link_instruction(command, false);
      }
      break;
    case 2: // Set System Parameters instructions
      code += print_if_version_2(command);
      code += print_system_set(command);
      code += print_link_instruction(command, true);
      break;
    case 3: // Set General Parameters instructions
      code += print_if_version_3(command);
      code += print_set_version_1(command);
      code += print_link_instruction(command, true);
      break;
    case 4: // Set, Compare -> LinkSub instructions
      code += print_set_version_2(command);
      code += ', ';
      code += print_if_version_4(command);
      code += print_linksub_instruction(command);
      break;
    case 5: // Compare -> (Set and LinkSub) instructions
      code += print_if_version_5(command);
      code += '{ ';
      code += print_set_version_3(command);
      code += ', ';
      code += print_linksub_instruction(command);
      code += ' }';
      break;
    case 6: // Compare -> Set, always LinkSub instructions
      code += print_if_version_5(command);
      code += '{ ';
      code += print_set_version_3(command);
      code += ' } ';
      code += print_linksub_instruction(command);
      break;
    default:
      console.error('Unknown command type (%i)', getbits(command, 63, 3));
  }

  return code;
}

/**
 * Extracts some bits from the command.
 *
 * @param {string} instruction
 * @param {number} start
 * @param {number} count
 * @return {number}
 */
function getbits(instruction: string, start: number, count: number): number {
  if (count === 0) {
    return 0;
  }

  if (start - count < -1 || count < 0 || start < 0 || count > 32 || start > 63) {
    console.error('Bad call to getbits(). Parameter out of range.');
    return 0;
  }

  return Number(parseInt(instruction.substr(63 - start, count), 2).toString(10));
}

function print_system_reg(reg) {
  var code = '';
  if (reg < VM.system_reg_abbr_table.length / VM.system_reg_abbr_table[0].length) {
    code += sprintf('%s (SRPM:%d)', VM.system_reg_table[reg], reg);
  } else {
    console.error('jsdvdnav: Unknown system register (reg=%d)', reg);
  }

  return code;
}

function print_g_reg(reg) {
  var code = '';
  if (reg < 0x10) {
    code += sprintf('g[%s]', utils.toHex(reg));
  } else {
    console.error('jsdvdnav: Unknown general register');
  }

  return code;
}

function print_reg(reg) {
  var code = '';
  if (reg & 0x80) {
    code += print_system_reg(reg & 0x7F);
  } else {
    code += print_g_reg(reg & 0x7F);
  }

  return code;
}

function print_cmp_op(op) {
  var code = '';
  if (op < VM.cmp_op_table.length / VM.cmp_op_table[0].length) {
    code += sprintf(' %s ', VM.cmp_op_table[op]);
  } else {
    console.error('jsdvdnav: Unknown compare op');
  }

  return code;
}

function print_set_op(op) {
  var code = '';
  if (op < VM.set_op_table.length / VM.cmp_op_table[0].length) {
    code += sprintf(' %s ', VM.set_op_table[op]);
  } else {
    console.error('jsdvdnav: Unknown set op');
  }

  return code;
}

function print_reg_or_data(command, immediate, start) {
  var code = '';
  if (immediate) {
    var i = getbits(command, start, 16);

    code += sprintf('%s', utils.toHex(i));
    if (utils.isprint(i & 0xFF) && utils.isprint((i >> 8) & 0xFF)) {
      code += sprintf(' ("%s")', utils.bit2str(i));
    }
  } else {
    code += print_reg(getbits(command, start - 8, 8));
  }

  return code;
}

function print_reg_or_data_2(command, immediate, start) {
  var code = '';
  if (immediate) {
    code += sprintf('%s', utils.toHex(getbits(command, start - 1, 7)));
  } else {
    code += sprintf('g[%s]', utils.toHex(getbits(command, start - 4, 4)));
  }

  return code;
}

function print_reg_or_data_3(command, immediate, start) {
  var code = '';
  if (immediate) {
    var i = getbits(command, start, 16);

    code += sprintf('%s', utils.toHex(i));
    if (utils.isprint(i & 0xFF) && utils.isprint((i >> 8) & 0xFF)) {
      code += sprintf(' ("%s")', utils.bit2str(i));
    }
  } else {
    code += print_reg(getbits(command, start, 8));
  }

  return code;
}

function print_if_version_1(command) {
  var code = '';
  var op = getbits(command, 54, 3);

  if (op) {
    code += 'if (';
    code += print_g_reg(getbits(command, 39, 8));
    code += print_cmp_op(op);
    code += print_reg_or_data(command, getbits(command, 55, 1), 31);
    code += ') ';
  }

  return code;
}

function print_if_version_2(command) {
  var code = '';
  var op = getbits(command, 54, 3);

  if (op) {
    code += 'if (';
    code += print_reg(getbits(command, 15, 8));
    code += print_cmp_op(op);
    code += print_reg(getbits(command, 7, 8));
    code += ') ';
  }

  return code;
}

function print_if_version_3(command) {
  var code = '';
  var op = getbits(command, 54, 3);

  if (op) {
    code += 'if (';
    code += print_g_reg(getbits(command, 43, 4));
    code += print_cmp_op(op);
    code += print_reg_or_data(command, getbits(command, 55, 1), 15);
    code += ') ';
  }

  return code;
}

function print_if_version_4(command) {
  var code = '';
  var op = getbits(command, 54, 3);

  if (op) {
    code += 'if (';
    code += print_g_reg(getbits(command, 51, 4));
    code += print_cmp_op(op);
    code += print_reg_or_data(command, getbits(command, 55, 1), 31);
    code += ') ';
  }

  return code;
}

function print_if_version_5(command) {
  var code = '';
  var op = getbits(command, 54, 3);
  var set_immediate = getbits(command, 60, 1);

  if (op) {
    if (set_immediate) {
      code += 'if (';
      code += print_g_reg(getbits(command, 31, 8));
      code += print_cmp_op(op);
      code += print_reg(getbits(command, 23, 8));
      code += ') ';
    } else {
      code += 'if (';
      code += print_g_reg(getbits(command, 39, 8));
      code += print_cmp_op(op);
      code += print_reg_or_data(command, getbits(command, 55, 1), 31);
      code += ') ';
    }
  }

  return code;
}

function print_special_instruction(command) {
  var code = '';
  var op = getbits(command, 51, 4);

  switch (op) {
    case 0: // NOP
      code += 'console.log(\'NOP\');';
      break;
    case 1: // Goto line
      code += sprintf('Goto %s', getbits(command, 7, 8));
      break;
    case 2: // Break
      code += 'Break';
      break;
    case 3: // Parental level
      code += sprintf('SetTmpPML %s, Goto %s', getbits(command, 11, 4), getbits(command, 7, 8));
      break;
    default:
      console.error('jsdvdnav: Unknown special instruction (%i)', getbits(command, 51, 4));
  }

  return code;
}

function print_linksub_instruction(command) {
  var code = '';
  var linkop = getbits(command, 7, 8);
  var button = getbits(command, 15, 6);

  if (linkop < VM.link_table.length / VM.link_table[0].length) {
    code += sprintf('%s (button %s)', VM.link_table[linkop], button);
  } else {
    console.error('jsdvdnav: Unknown linksub instruction (%i)', linkop);
  }

  return code;
}

function print_link_instruction(command, optional: boolean) {
  var code = '';
  var op = getbits(command, 51, 4);

  if (optional && op)
    code += ', ';

  switch (op) {
    case 0:
      if (!optional)
        console.error('jsdvdnav: NOP (link)!');
      break;
    case 1:
      code += print_linksub_instruction(command);
      break;
    case 4:
      code += sprintf('LinkPGCN %s', getbits(command, 14, 15));
      break;
    case 5:
      code += sprintf('LinkPTT %s (button %s)', getbits(command, 9, 10), getbits(command, 15, 6));
      break;
    case 6:
      code += sprintf('LinkPGN %s (button %s)', getbits(command, 6, 7), getbits(command, 15, 6));
      break;
    case 7:
      code += sprintf('LinkCN %s (button %s)', getbits(command, 7, 8), getbits(command, 15, 6));
      break;
    default:
      console.error('jsdvdnav: Unknown link instruction');
  }

  return code;
}

function print_jump_instruction(command) {
  var code = '';
  switch (getbits(command, 51, 4)) {
    case 1:
      return 'dvd.stop();';
      break;
    case 2:
      // JumpTT x
      return sprintf('dvd.playByOrder(%s);', getbits(command, 22, 7));
      break;
    case 3:
      // JumpVTS_TT x
      code += sprintf('JumpVTS_TT %s', getbits(command, 22, 7));
      break;
    case 5:
      // JumpVTS_PTT x:x
      code += sprintf('JumpVTS_PTT %s:%s', getbits(command, 22, 7), getbits(command, 41, 10));
      break;
    case 6:
      switch (getbits(command, 23, 2)) {
        case 0:
          code += 'JumpSS FP';
          break;
        case 1:
          // JumpSS VMGM (menu x)
          code += sprintf('JumpSS VMGM (menu %s)', getbits(command, 19, 4));
          break;
        case 2:
          // JumpSS VTSM (vts x, title x, menu x)
          code += sprintf('JumpSS VTSM (vts %s, title %s, menu %s)', getbits(command, 30, 7), getbits(command, 38, 7), getbits(command, 19, 4));
          break;
        case 3:
          // JumpSS VMGM (pgc x)
          code += sprintf('JumpSS VMGM (pgc %s)', getbits(command, 46, 15));
          break;
      }
      break;
    case 8:
      switch (getbits(command, 23, 2)) {
        case 0:
          // CallSS FP (rsm_cell x)
          code += sprintf('CallSS FP (rsm_cell %s)', getbits(command, 31, 8));
          break;
        case 1:
          // CallSS VMGM (menu x, rsm_cell x)
          code += sprintf('CallSS VMGM (menu %s, rsm_cell %s)', getbits(command, 19, 4), getbits(command, 31, 8));
          break;
        case 2:
          // CallSS VTSM (menu x, rsm_cell x)
          code += sprintf('CallSS VTSM (menu %s, rsm_cell %s)', getbits(command, 19, 4), getbits(command, 31, 8));
          break;
        case 3:
          // CallSS VMGM (pgc x, rsm_cell x)
          code += sprintf('CallSS VMGM (pgc %s, rsm_cell %s)', getbits(command, 46, 15), getbits(command, 31, 8));
          break;
      }
      break;
    default:
      console.error('jsdvdnav: Unknown Jump/Call instruction');
  }

  return code;
}

function print_system_set(command) {
  var code = '';
  var i = 0;
  // FIXME: What about SPRM11 ? Karaoke
  // Surely there must be some system set command for that?

  switch (getbits(command, 59, 4)) {
    case 1: // Set system reg 1 &| 2 &| 3 (Audio, Subp. Angle)
      for (i = 1; i <= 3; i++) {
        if (getbits(command, 47 - (i * 8), 1)) {
          code += print_system_reg(i);
          code += ' = ';
          code += print_reg_or_data_2(command, getbits(command, 60, 1), 47 - (i * 8));
          code += '; ';
        }
      }
      break;
    case 2: // Set system reg 9 & 10 (Navigation timer, Title PGC number)
      code += print_system_reg(9);
      code += ' = ';
      code += print_reg_or_data(command, getbits(command, 60, 1), 47);
      code += '; ';
      code += print_system_reg(10);
      code += sprintf(' = %s;', getbits(command, 30, 15));
      // ??
      break;
    case 3: // Mode: Counter / Register + Set
      code += 'SetMode ';
      if (getbits(command, 23, 1)) {
        code += 'Counter ';
      } else {
        code += 'Register ';
      }
      code += print_g_reg(getbits(command, 19, 4));
      code += print_set_op(0x01);
      // '='
      code += print_reg_or_data(command, getbits(command, 60, 1), 47);
      break;
    case 6: // Set system reg 8 (Highlighted button)
      code += print_system_reg(8);
      if (getbits(command, 60, 1)) { // immediate
        code += sprintf(' = %s (button no %d);', utils.toHex(getbits(command, 31, 16)), getbits(command, 31, 6));
      } else {
        code += sprintf(' = g[%s];', utils.toHex(getbits(command, 19, 4)));
      }
      break;
    default:
      console.error('jsdvdnav: Unknown system set instruction (%i)', getbits(command, 59, 4));
  }

  return code;
}

function print_set_version_1(command) {
  var code = '';
  var set_op = getbits(command, 59, 4);

  if (set_op) {
    code += print_g_reg(getbits(command, 35, 4));
    code += print_set_op(set_op);
    code += print_reg_or_data(command, getbits(command, 60, 1), 31);
    code += ';';
  } else {
    code += 'console.log(\'NOP\');';
  }

  return code;
}

function print_set_version_2(command) {
  var code = '';
  var set_op = getbits(command, 59, 4);

  if (set_op) {
    code += print_g_reg(getbits(command, 51, 4));
    code += print_set_op(set_op);
    code += print_reg_or_data(command, getbits(command, 60, 1), 47);
    code += ';';
  } else {
    code += 'console.log(\'NOP\');';
  }

  return code;
}

function print_set_version_3(command) {
  var code = '';
  var set_op = getbits(command, 59, 4);

  if (set_op) {
    code += print_g_reg(getbits(command, 51, 4));
    code += print_set_op(set_op);
    code += print_reg_or_data_3(command, getbits(command, 60, 1), 47);
    code += ';';
  } else {
    code += 'console.log(\'NOP\');';
  }

  return code;
}