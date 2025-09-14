#!/usr/bin/env python3
import sys

def main():
    file_id = sys.argv[1] if len(sys.argv) > 1 else ''
    print(f'[extract_clips] queued {file_id}')

if __name__ == '__main__':
    main()
