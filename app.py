from flask import Flask, render_template, request, jsonify, send_file
import io

app = Flask(__name__)

# Xerox Machine Identification Code (MIC) decoder
# Based on EFF research: https://w2.eff.org/Privacy/printers/docucolor/
#
# The pattern is a 15-column x 8-row grid of tiny yellow dots.
# Row 1 (top) is parity. Column 1 (left) is parity.
# Data is read per column, top-to-bottom, with columns numbered 1-15.
# Each column holds 7 data bits (rows 2-8) read top-to-bottom.
# All rows/columns maintain odd parity.
#
# Column mapping:
#   15: unknown/constant per printer
#   14,13,12,11: serial number (BCD, two digits per column)
#   10: separator (typically all 1s)
#    9: unused
#    8: year (without century)
#    7: month
#    6: day
#    5: hour
#    4: unused
#    3: unused
#    2: minute
#    1: row parity

COLUMN_MAP = {
    2: 'minute',
    5: 'hour',
    6: 'day',
    7: 'month',
    8: 'year',
    10: 'separator',
    11: 'serial3',  # least significant BCD pair
    12: 'serial2',
    13: 'serial1',
    14: 'serial0',  # most significant BCD pair
    15: 'unknown',
}


def decode_column(col_bits):
    """Decode 7 data bits (rows 2-8) from a column into an integer value."""
    val = 0
    for i, bit in enumerate(col_bits):
        val |= (bit << (6 - i))
    return val


def decode_digit_pair(val):
    """Decode a column value as two decimal digits."""
    return val // 10, val % 10


def check_parity(grid):
    """Check odd parity for all rows and columns. Returns list of errors."""
    errors = []
    rows = len(grid)
    cols = len(grid[0]) if grid else 0

    # Skip row 0 (parity row) — it exists to make each column's total odd
    for r in range(1, rows):
        if sum(grid[r]) % 2 == 0:
            errors.append(f"Row {r + 1} parity error")

    # Skip column 0 (parity column) — with 8 rows its own parity is structurally determined
    for c in range(1, cols):
        col_sum = sum(grid[r][c] for r in range(rows))
        if col_sum % 2 == 0:
            errors.append(f"Column {c + 1} parity error")

    return errors


def decode_grid(grid):
    """Decode an 8x15 grid (8 rows, 15 columns) into MIC data.
    grid[row][col] where row 0 = parity row, col 0 = parity column.
    """
    result = {}

    # Check parity
    parity_errors = check_parity(grid)
    result['parity_errors'] = parity_errors

    # Extract data bits per column (rows 1-7, i.e. grid rows 1-7)
    col_values = {}
    for col_idx in range(1, 15):  # columns 2-15 (0-indexed: 1-14)
        col_num = col_idx + 1  # 1-indexed column number
        bits = [grid[r][col_idx] for r in range(1, 8)]
        col_values[col_num] = decode_column(bits)

    # Decode fields
    result['minute'] = col_values.get(2, 0)
    result['hour'] = col_values.get(5, 0)
    result['day'] = col_values.get(6, 0)
    result['month'] = col_values.get(7, 0)
    result['year'] = col_values.get(8, 0)
    result['separator'] = col_values.get(10, 0)
    result['unknown'] = col_values.get(15, 0)

    # Serial number from columns 14,13,12,11 (most to least significant)
    serial_digits = []
    for col_num in [14, 13, 12, 11]:
        val = col_values.get(col_num, 0)
        h, l = decode_digit_pair(val)
        serial_digits.extend([h, l])
    result['serial'] = ''.join(str(d) for d in serial_digits)

    # Format date/time
    year = result['year']
    year = 2000 + year if year <= 50 else 1900 + year
    try:
        result['timestamp'] = (
            f"{year}-{result['month']:02d}-{result['day']:02d} "
            f"{result['hour']:02d}:{result['minute']:02d}"
        )
    except (ValueError, TypeError):
        result['timestamp'] = 'Invalid'

    result['col_values'] = {str(k): v for k, v in col_values.items()}

    return result


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/decode', methods=['POST'])
def decode():
    data = request.get_json()
    grid = data.get('grid', [])

    # Validate dimensions
    if len(grid) != 8 or any(len(row) != 15 for row in grid):
        return jsonify({'error': 'Grid must be 8 rows x 15 columns'}), 400

    result = decode_grid(grid)
    return jsonify(result)


@app.route('/save', methods=['POST'])
def save():
    data = request.get_json()
    grid = data.get('grid', [])
    lines = []
    for row in grid:
        lines.append(','.join(str(v) for v in row))
    content = '\n'.join(lines)
    buf = io.BytesIO(content.encode('utf-8'))
    buf.seek(0)
    return send_file(buf, as_attachment=True,
                     download_name='xerox_mic_grid.txt',
                     mimetype='text/plain')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    f = request.files['file']
    content = f.read().decode('utf-8').strip()
    grid = []
    for line in content.split('\n'):
        line = line.strip()
        if line:
            row = [int(v.strip()) for v in line.split(',')]
            grid.append(row)

    if len(grid) != 8 or any(len(row) != 15 for row in grid):
        return jsonify({'error': 'Grid must be 8 rows x 15 columns'}), 400

    result = decode_grid(grid)
    result['grid'] = grid
    return jsonify(result)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
