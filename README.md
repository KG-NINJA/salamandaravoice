# VLM-5030風 ルールTTS

シンプルなルールベースのテキスト読み上げ（TTS）システムで、古いゲーム機の音声合成チップ（VLM-5030）の質感を再現します。
JavaScript/WebAudioのみで実装され、外部依存なしで動作します。

## 特徴

- テキスト→音素（ローマ字/カタカナ対応）→パルス/ノイズ励起→フォルマント合成→8kHz/ビットクラッシュ
- 英語/カタカナ対応の簡易G2P（Grapheme-to-Phoneme）
- 3フォルマントBPF（各バンド個別状態で直列1回ずつ通す）
- ポストFX：LPF→量子化→短ディレイ→クリップ→8kHz化
- WAV出力（16-bit PCM）

## セットアップ

1. リポジトリをクローンまたはダウンロードします
2. ローカルのWebサーバーで実行するか、ファイルを直接ブラウザで開きます
3. GitHub Pagesでも利用可能です

## 使い方

1. テキストボックスに英語またはカタカナでテキストを入力します
2. プリセットボタンを使用して、定義済みのフレーズを選択することもできます
3. 「▶ 再生」ボタンをクリックして音声を再生します
4. 「💾 WAV書き出し」ボタンをクリックしてWAVファイルとして保存します
5. 「🎤 ボイスチェンジ」ボタンでマイク録音を開始/停止し、変換後の音声を再生します

## 推奨設定

最も「それっぽい」音質を得るための推奨設定：

- サンプリング周波数(合成): 16000 Hz
- 最終出力FS: 8000 Hz
- ピッチ: 120 Hz
- ガラつき(量子化): 5 bit
- 無声子音のノイズ強度: 0.18
- ディレイ(筐体鳴り): 0.045 s
- 子音シャリ感: オン

## プリセット一覧

既存のフレーズ:
- FIRE!
- DESTROY THEM ALL!
- ATTACK!
- MISSION START!

新規プリセット:
- LAUNCH!
- LASER READY!
- WARNING!
- MISSION COMPLETE!
- POWER UP!
- TARGET DESTROYED!

## エンベロープ比較テスト

5msのアタック/ディケイエンベロープの効果を確認するため、
以下のテキストを入力して有無を聴き比べてください。

- 日本語: こんにちは
- 英語: HELLO WORLD
- スペイン語: HOLA AMIGO

エンベロープを無効化するには `synth.js` と `script.js` 内の
`exc *= env` 行をコメントアウトしてください。

## 既知の限界

- 完全な再現ではなく「質感再現」を目指しています
- 実際のVLM-5030チップの詳細な仕様とは異なる部分があります
- 英語の発音辞書は限定的で、特定のゲーム風フレーズに最適化されています
- 日本語はカタカナのみ対応（ひらがな・漢字は非対応）

## ライセンス

MIT License

Copyright (c) 2025 KG / #KGNINJA

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.