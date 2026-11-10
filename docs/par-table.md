### Boot Sequence

| # | id | name | opt | par steps | par size | sol steps | sol size | battery | floors | new |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | w1-1 | Wake-Up Call | 6 | 6 | 1 | 6 | 1 | 2000 | 1 | move |
| 2 | w1-2 | Locker Corner | 13 | 13 | 7 | 13 | 7 | 2000 | 1 | left right |
| 3 | w1-3 | About Face | 20 | 20 | 7 | 20 | 7 | 2000 | 1 |  |
| 4 | w1-4 | Stairwell | 21 | 21 | 6 | 21 | 6 | 2000 | 1 | repeat |
| 5 | w1-5 | Loose Bolt | 9 | 9 | 6 | 9 | 6 | 2000 | 1 | grab drop |
| 6 | w1-6 | Restock Run | 36 | 36 | 10 | 36 | 10 | 2000 | 1 |  |
| 7 | w1-7 | Low Battery | 16 | 16 | 7 | 16 | 7 | 16 | 1 |  |
| 8 | w1-8 | Junction Sweep | 29 | 29 | 8 | 31 | 8 | 2000 | 1 |  |

### Sensor Calibration

| # | id | name | opt | par steps | par size | sol steps | sol size | battery | floors | new |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | w2-1 | Sensor Check | 9 | 9 | 5 | 9 | 5 | 2000 | 3 | move left right grab drop bin repeat while |
| 2 | w2-2 | Corner Probe | 9 | 9 | 5 | 9 | 5 | 2000 | 3 | goal clear wall |
| 3 | w2-3 | Scattered Bolts | 11 | 11 | 4 | 11 | 4 | 2000 | 3 | item if |
| 4 | w2-4 | Cable Duct | 15 | 15 | 7 | 15 | 7 | 2000 | 3 | clear_right |
| 5 | w2-5 | Paint Codes | 9 | 10 | 6 | 10 | 6 | 2000 | 3 | red blue |
| 6 | w2-6 | Parts Shuttle | 53 | 53 | 11 | 53 | 11 | 2000 | 3 |  |
| 7 | w2-7 | Locker Sweep | 34 | 40 | 12 | 40 | 12 | 2000 | 3 | clear_left holding |
| 8 | w2-8 | Calibration Run | 25 | 25 | 10 | 25 | 10 | 2000 | 3 |  |

### Assembly Line

| # | id | name | opt | par steps | par size | sol steps | sol size | battery | floors | new |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | w3-1 | Pallet Stairs | 17 | 17 | 8 | 17 | 8 | 2000 | 1 | move left right grab drop repeat while if def |
| 2 | w3-2 | Pillar Loop | 21 | 21 | 8 | 21 | 8 | 2000 | 3 | bin goal clear wall item clear_right red blue clear_left holding |
| 3 | w3-3 | Odometer | 13 | 13 | 11 | 13 | 11 | 2000 | 3 | memory |
| 4 | w3-4 | Zigzag Relay | 12 | 15 | 9 | 15 | 9 | 2000 | 3 |  |
| 5 | w3-5 | Return Trip | 47 | 47 | 17 | 47 | 17 | 2000 | 3 |  |
| 6 | w3-6 | Every Third Mark | 5 | 12 | 7 | 12 | 7 | 2000 | 3 | yellow |
| 7 | w3-7 | Floor Select | 12 | 12 | 11 | 12 | 11 | 2000 | 3 |  |
| 8 | w3-8 | Last Call | 29 | 29 | 20 | 29 | 20 | 2000 | 3 |  |

### Maze Wing

| # | id | name | opt | par steps | par size | sol steps | sol size | battery | floors | new |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | w4-1 | Right-Hand Rule | 30 | 30 | 8 | 30 | 8 | 2000 | 3 | move left right grab drop goal clear clear_right while if repeat |
| 2 | w4-2 | Lost Bolts | 55 | 71 | 10 | 71 | 10 | 2000 | 3 | item |
| 3 | w4-3 | Left-Hand Wing | 32 | 32 | 8 | 32 | 8 | 2000 | 3 | clear_left |
| 4 | w4-4 | From the Stacks | 23 | 69 | 14 | 69 | 14 | 2000 | 3 | bin def |
| 5 | w4-5 | Hold the Heading | 11 | 11 | 16 | 11 | 16 | 20 | 3 | memory |
| 6 | w4-6 | Planner Online | 13 | 17 | 5 | 17 | 5 | 2000 | 3 | scan |
| 7 | w4-7 | Shortest Delivery | 57 | 64 | 9 | 64 | 9 | 2000 | 3 | holding |
| 8 | w4-8 | Night Inventory | 87 | 98 | 11 | 98 | 11 | 120 | 3 |  |

### Swarm Floor

| # | id | name | opt | par steps | par size | sol steps | sol size | battery | floors | new |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | w5-1 | Hold the Door | - | 14 | 11 | 14 | 11 | 2000 | 3 | move left right grab drop wait clear item bin while repeat if |
| 2 | w5-2 | Round Trip | - | 25 | 19 | 25 | 19 | 2000 | 3 | signal |
| 3 | w5-3 | Bucket Brigade | - | 81 | 28 | 81 | 28 | 2000 | 3 | yellow |
| 4 | w5-4 | Door Swap | - | 33 | 30 | 33 | 30 | 2000 | 1 |  |
| 5 | w5-5 | Token Ring | - | 21 | 36 | 21 | 36 | 2000 | 1 |  |
| 6 | w5-6 | Doorstop | - | 20 | 18 | 20 | 18 | 2000 | 1 | goal |
| 7 | w5-7 | Relay Line | - | 80 | 45 | 80 | 45 | 2000 | 1 |  |
| 8 | w5-8 | Night Shift | - | 28 | 32 | 28 | 32 | 2000 | 1 |  |
