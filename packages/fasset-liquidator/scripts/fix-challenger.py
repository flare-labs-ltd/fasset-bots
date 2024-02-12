removed_indexes = []

with open('Challenger.sol', 'r') as f:
    license_line_count = 0
    lines = f.readlines()
    for i, line in enumerate(lines):
        if line.strip() == '// SPDX-License-Identifier: MIT':
            license_line_count += 1
            if license_line_count == 2:
                removed_indexes.append(i)
        if line.strip() == 'pragma abicoder v2;':
            removed_indexes.append(i)

with open('Challenger.sol', 'w') as f:
    for i, line in enumerate(lines):
        if i not in removed_indexes:
            f.write(line)