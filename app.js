// ===== Receipt Manager App =====

class ReceiptManager {
    constructor() {
        this.expenses = [];
        this.currentImageData = null;
        this.init();
    }

    init() {
        this.loadFromStorage();
        this.initTabs();
        this.initUpload();
        this.initForm();
        this.initFilters();
        this.initExport();
        this.renderList();
        this.renderSummary();
    }

    // ===== Tab Navigation =====
    initTabs() {
        const tabs = document.querySelectorAll('.nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        // Update active tab button
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update active section
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.getElementById(`${tabName}-section`).classList.add('active');

        // Refresh content when switching tabs
        if (tabName === 'list') {
            this.renderList();
        } else if (tabName === 'summary') {
            this.renderSummary();
        }
    }

    // ===== Upload Handling =====
    initUpload() {
        const uploadArea = document.getElementById('upload-area');
        const fileInput = document.getElementById('file-input');
        const cameraInput = document.getElementById('camera-input');

        // Click on upload area
        uploadArea.addEventListener('click', (e) => {
            if (e.target.tagName === 'LABEL' || e.target.closest('label')) return;
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        cameraInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.processImage(files[0]);
            }
        });
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.processImage(file);
        }
        event.target.value = ''; // Reset input
    }

    async processImage(file) {
        if (!file.type.startsWith('image/')) {
            this.showToast('画像ファイルを選択してください', 'error');
            return;
        }

        // Show preview
        const reader = new FileReader();
        reader.onload = async (e) => {
            this.currentImageData = e.target.result;
            document.getElementById('preview-image').src = this.currentImageData;
            document.getElementById('preview-card').style.display = 'block';
            document.getElementById('ocr-status').style.display = 'flex';
            document.getElementById('form-card').style.display = 'none';

            // Run OCR
            try {
                await this.runOCR(this.currentImageData);
            } catch (error) {
                console.error('OCR Error:', error);
                this.showToast('読み取りに失敗しました。手動で入力してください。', 'error');
                this.showForm({});
            }
        };
        reader.readAsDataURL(file);
    }

    async runOCR(imageData) {
        const worker = await Tesseract.createWorker('jpn+eng');

        try {
            const result = await worker.recognize(imageData);
            const text = result.data.text;
            console.log('OCR Result:', text);

            // Extract data from OCR text
            const extractedData = this.extractDataFromText(text);
            this.showForm(extractedData);
        } finally {
            await worker.terminate();
        }
    }

    extractDataFromText(text) {
        const data = {};

        console.log('OCR Text for parsing:', text); // デバッグ用

        // テキストを正規化（全角数字を半角に、スペースを除去して処理しやすくする）
        // ただし、金額や日付の区切りとしてのスペースは保持したいので、行ごとの処理も併用する
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        // 全角数字変換用関数
        const toHalfWidth = (str) => {
            return str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        };

        const normalizedText = toHalfWidth(text);

        // ==========================================
        // 1. 日付の抽出 (Date Extraction)
        // ==========================================
        // スペース許容型の日付パターン
        const datePatterns = [
            // 2024年12月10日 (スペース許容: 2 0 2 4 年 ...)
            { regex: /(\d[\s\d]{3})\s*年\s*(\d[\s\d]{0,2})\s*月\s*(\d[\s\d]{0,2})\s*日?/, type: 'ymd' },
            // 2024/12/10, 2024-12/10
            { regex: /(\d[\s\d]{3})[\/\-\.．]\s*(\d[\s\d]{0,2})[\/\-\.．]\s*(\d[\s\d]{0,2})/, type: 'ymd' },
            // 令和6年12月10日
            { regex: /令\s*和\s*(\d[\s\d]{0,2})\s*年\s*(\d[\s\d]{0,2})\s*月\s*(\d[\s\d]{0,2})\s*日?/, type: 'reiwa' },
            // R6.12.10
            { regex: /R\s*(\d[\s\d]{0,2})[\.\/\-]\s*(\d[\s\d]{0,2})[\.\/\-]\s*(\d[\s\d]{0,2})/, type: 'reiwa' }
        ];

        for (const { regex, type } of datePatterns) {
            const match = normalizedText.match(regex);
            if (match) {
                // 数字の中のスペースを除去してパース
                const p1 = parseInt(match[1].replace(/\s/g, ''));
                const p2 = parseInt(match[2].replace(/\s/g, ''));
                const p3 = parseInt(match[3].replace(/\s/g, ''));

                let year, month, day;

                switch (type) {
                    case 'ymd':
                        year = p1;
                        month = p2;
                        day = p3;
                        break;
                    case 'reiwa':
                        year = 2018 + p1;
                        month = p2;
                        day = p3;
                        break;
                }

                // 妥当性チェック (2000年〜2100年)
                if (year < 100 && year > 0) year += 2000; // 2桁年の補正

                if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
                    data.date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    console.log('Extracted date:', data.date);
                    break;
                }
            }
        }

        // ==========================================
        // 2. 金額の抽出 (Amount Extraction) - 改善版
        // ==========================================
        // 戦略:
        // 1. 「合計」などのキーワードの同一行にある数字を最優先
        // 2. ポイントなどを除外
        // 3. ¥マークや円がなくても、合計行の数字を認識

        let foundAmount = null;
        let amountConfidence = 0; // 信頼度スコア

        // 金額抽出用正規表現（カンマ付き・カンマなし両対応、スペース許容）
        const extractPrice = (str) => {
            // OCRエラー補正: O→0, l/I→1, S→5, B→8
            let corrected = str
                .replace(/[OＯ]/g, '0')
                .replace(/[lIｌＩ]/g, '1')
                .replace(/[SＳ]/g, '5')
                .replace(/[BＢ]/g, '8');

            // スペースで分断された数字を結合（例: "1 , 5 0 0" → "1,500"）
            corrected = corrected.replace(/(\d)\s+,\s+/g, '$1,').replace(/,\s+(\d)/g, ',$1');
            corrected = corrected.replace(/(\d)\s+(\d)/g, '$1$2');

            // カンマ付き数字 (例: 1,500 or 12,345)
            let match = corrected.match(/([0-9]{1,3}(?:,[0-9]{3})+)/);
            if (match) return parseInt(match[1].replace(/,/g, ''));

            // カンマなし数字 (例: 1500) - 3桁以上の数字
            match = corrected.match(/([0-9]{3,7})/);
            if (match) return parseInt(match[1]);

            return null;
        };

        // 同一行から「キーワード直後の数字」を抽出（最優先）
        const extractPriceAfterKeyword = (str, keyword) => {
            // OCRエラー補正
            let corrected = str
                .replace(/[OＯ]/g, '0')
                .replace(/[lIｌＩ]/g, '1')
                .replace(/[SＳ]/g, '5')
                .replace(/[BＢ]/g, '8');
            corrected = corrected.replace(/(\d)\s+,\s+/g, '$1,').replace(/,\s+(\d)/g, ',$1');
            corrected = corrected.replace(/(\d)\s+(\d)/g, '$1$2');

            // キーワード以降の部分を取得
            const keywordMatch = corrected.match(keyword);
            if (!keywordMatch) return null;

            const afterKeyword = corrected.substring(keywordMatch.index + keywordMatch[0].length);

            // キーワード直後の数字を探す（¥マーク有無両対応）
            let match = afterKeyword.match(/[¥￥]?\s*([0-9]{1,3}(?:,[0-9]{3})+)/);
            if (match) return parseInt(match[1].replace(/,/g, ''));

            match = afterKeyword.match(/[¥￥]?\s*([0-9]{3,7})/);
            if (match) return parseInt(match[1]);

            return null;
        };

        // 優先キーワード（上から順に優先度が高い）
        const totalKeywords = [
            { regex: /合\s*計\s*金\s*額/i, priority: 11, name: '合計金額' },
            { regex: /合\s*計\s*[（(]?\s*税\s*込?\s*[)）]?/i, priority: 10, name: '合計(税込)' },
            { regex: /お\s*支\s*払\s*い?\s*[額金]?/i, priority: 9, name: 'お支払い' },
            { regex: /ご\s*請\s*求\s*[額金]?/i, priority: 9, name: 'ご請求' },
            { regex: /合\s*計/i, priority: 8, name: '合計' },
            { regex: /計\s*[：:]/i, priority: 7, name: '計:' },
            { regex: /小\s*計/i, priority: 5, name: '小計' },
            { regex: /Total/i, priority: 6, name: 'Total' }
        ];

        // 除外キーワード（これらを含む行の数字は合計ではない可能性が高い）
        const excludeKeywords = [
            /ポ\s*イ\s*ン\s*ト/i,  // ポイント
            /Pt/i,
            /お\s*預\s*り/i,
            /お\s*釣\s*り/i,
            /釣\s*銭/i,
            /対\s*象/i,      // 税対象額
            /消\s*費\s*税/i, // 消費税額（「税込」はOK）
            /内\s*税/i,
            /外\s*税/i,
            /値\s*引/i,      // 値引き額
            /割\s*引/i,
            /クーポン/i,
            /会\s*員\s*番\s*号/i,
            /電\s*話/i,
            /TEL/i,
            /No\./i,
            /番\s*号/i
        ];

        // 行ごとのスキャン（優先度ベース）
        let candidates = [];

        for (let i = 0; i < lines.length; i++) {
            const line = toHalfWidth(lines[i]);

            // 除外キーワードが含まれていたらスキップ
            if (excludeKeywords.some(k => k.test(line))) continue;

            // 各優先キーワードをチェック
            for (const { regex, priority, name } of totalKeywords) {
                if (regex.test(line)) {
                    // 1. 同じ行でキーワード直後の数字を探す（最優先）
                    let amount = extractPriceAfterKeyword(line, regex);

                    // 2. 同じ行に金額がない場合、行全体から探す
                    if (!amount) {
                        amount = extractPrice(line);
                    }

                    // 3. それでもなければ次の行を見る
                    if (!amount && i + 1 < lines.length) {
                        const nextLine = toHalfWidth(lines[i + 1]);
                        if (!excludeKeywords.some(k => k.test(nextLine))) {
                            amount = extractPrice(nextLine);
                        }
                    }

                    if (amount && amount > 0 && amount < 10000000) {
                        candidates.push({ amount, priority, name, line: i });
                        console.log(`Found candidate: ${name} = ${amount} (priority: ${priority})`);
                    }
                }
            }
        }

        // 最も優先度の高い候補を採用
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.priority - a.priority);
            foundAmount = candidates[0].amount;
            console.log(`Selected amount: ${foundAmount} from "${candidates[0].name}"`);
        }

        // キーワードで見つからなかった場合、¥マークや「円」のついている数字を探す（フォールバック）
        if (!foundAmount) {
            const pricePatterns = [
                /[¥￥]\s*([0-9,]+)/g,
                /([0-9,]+)\s*円/g
            ];

            let maxVal = 0;
            for (const pattern of pricePatterns) {
                const matches = normalizedText.matchAll(pattern);
                for (const m of matches) {
                    const val = parseInt(m[1].replace(/,/g, ''));
                    // 除外: 電話番号っぽい数字（10桁以上）やポイントの可能性がある行
                    if (val > maxVal && val < 10000000 && val > 10) {
                        maxVal = val;
                    }
                }
            }
            if (maxVal > 0) {
                foundAmount = maxVal;
                console.log(`Fallback amount (¥/円 marker): ${foundAmount}`);
            }
        }

        // それでも見つからない場合、合理的な範囲の最大数字を探す（最終フォールバック）
        if (!foundAmount) {
            let maxVal = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = toHalfWidth(lines[i]);
                // 除外キーワードをスキップ
                if (excludeKeywords.some(k => k.test(line))) continue;

                const amount = extractPrice(line);
                if (amount && amount > maxVal && amount < 1000000 && amount >= 100) {
                    maxVal = amount;
                }
            }
            if (maxVal > 0) {
                foundAmount = maxVal;
                console.log(`Last resort amount: ${foundAmount}`);
            }
        }

        if (foundAmount) {
            data.amount = foundAmount;
            console.log('Final extracted amount:', foundAmount);
        }

        // ==========================================
        // 3. 店舗名の抽出 (Vendor Extraction)
        // ==========================================
        // 最初の数行から、電話番号や日付っぽくない行を探す
        // 除外するキーワード
        const vendorExcludePatterns = [
            /^\d+$/,                    // 数字だけ
            /^[0-9\-\/\.\s:：]+$/,      // 日付っぽい
            /レシート/i,
            /領\s*収/i,
            /伝\s*票/i,                 // 伝票番号
            /番\s*号/i,
            /No\./i,
            /日\s*付/i,
            /^\s*様\s*$/,               // 「様」だけの行
            /合\s*計/i,
            /金\s*額/i,
            /税/i
        ];

        if (lines.length > 0) {
            for (let i = 0; i < Math.min(8, lines.length); i++) {
                const line = lines[i].trim();
                // 短い行を除外
                if (line.length <= 2) continue;

                // 除外パターンにマッチしたらスキップ
                if (vendorExcludePatterns.some(p => p.test(line))) continue;

                // 店舗名として採用
                data.vendor = line.substring(0, 50);
                console.log('Extracted vendor:', data.vendor);
                break;
            }
        }

        // カテゴリ推定は既存ロジック維持
        const textLower = text.toLowerCase();
        if (textLower.includes('ガソリン') || textLower.includes('給油') || textLower.includes('燃料')) {
            data.category = 'ガソリン代';
        } else if (textLower.includes('駐車') || textLower.includes('パーキング')) {
            data.category = '駐車場代';
        } else if (textLower.includes('高速') || textLower.includes('etc') || textLower.includes('料金所')) {
            data.category = '高速道路代';
        } else if (textLower.includes('美容') || textLower.includes('ヘア') || textLower.includes('サロン')) {
            data.category = '消耗品費';
        }

        return data;
    }

    showForm(data) {
        document.getElementById('ocr-status').style.display = 'none';
        document.getElementById('form-card').style.display = 'block';

        // Set form values - use OCR date if available, otherwise leave empty for user to fill
        document.getElementById('expense-date').value = data.date || '';
        document.getElementById('expense-amount').value = data.amount || '';
        document.getElementById('expense-vendor').value = data.vendor || '';
        document.getElementById('expense-category').value = data.category || '';
        document.getElementById('expense-memo').value = '';

        // Show hint if date was not extracted
        if (!data.date) {
            this.showToast('日付を読み取れませんでした。手動で入力してください。', 'error');
        }
    }

    // ===== Form Handling =====
    initForm() {
        const form = document.getElementById('expense-form');
        const cancelBtn = document.getElementById('cancel-btn');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveExpense();
        });

        cancelBtn.addEventListener('click', () => {
            this.resetUploadArea();
        });
    }

    saveExpense() {
        const expense = {
            id: Date.now(),
            date: document.getElementById('expense-date').value,
            amount: parseInt(document.getElementById('expense-amount').value) || 0,
            vendor: document.getElementById('expense-vendor').value,
            category: document.getElementById('expense-category').value,
            memo: document.getElementById('expense-memo').value,
            imageData: this.currentImageData,
            createdAt: new Date().toISOString()
        };

        this.expenses.push(expense);
        this.saveToStorage();
        this.resetUploadArea();
        this.showToast('経費を登録しました！', 'success');
    }

    resetUploadArea() {
        document.getElementById('preview-card').style.display = 'none';
        document.getElementById('form-card').style.display = 'none';
        document.getElementById('expense-form').reset();
        this.currentImageData = null;
    }

    deleteExpense(id) {
        if (confirm('この経費を削除しますか？')) {
            this.expenses = this.expenses.filter(e => e.id !== id);
            this.saveToStorage();
            this.renderList();
            this.showToast('削除しました', 'success');
        }
    }

    // ===== Storage =====
    saveToStorage() {
        // Save without image data to reduce storage size
        const dataToSave = this.expenses.map(e => ({
            ...e,
            imageData: null // Don't store images in localStorage
        }));
        localStorage.setItem('receipt_expenses', JSON.stringify(dataToSave));
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem('receipt_expenses');
            if (data) {
                this.expenses = JSON.parse(data);
            }
        } catch (error) {
            console.error('Failed to load data:', error);
            this.expenses = [];
        }
    }

    // ===== Filters =====
    initFilters() {
        const filterMonth = document.getElementById('filter-month');
        const filterCategory = document.getElementById('filter-category');

        filterMonth.addEventListener('change', () => this.renderList());
        filterCategory.addEventListener('change', () => this.renderList());
    }

    updateFilterOptions() {
        const filterMonth = document.getElementById('filter-month');
        const filterCategory = document.getElementById('filter-category');

        // Get unique months
        const months = new Set();
        this.expenses.forEach(e => {
            const date = new Date(e.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            months.add(monthKey);
        });

        // Update month filter
        const currentMonth = filterMonth.value;
        filterMonth.innerHTML = '<option value="">全期間</option>';
        Array.from(months).sort().reverse().forEach(month => {
            const [year, m] = month.split('-');
            filterMonth.innerHTML += `<option value="${month}">${year}年${parseInt(m)}月</option>`;
        });
        filterMonth.value = currentMonth;

        // Get unique categories
        const categories = new Set(this.expenses.map(e => e.category).filter(c => c));

        const currentCategory = filterCategory.value;
        filterCategory.innerHTML = '<option value="">全カテゴリ</option>';
        categories.forEach(cat => {
            filterCategory.innerHTML += `<option value="${cat}">${cat}</option>`;
        });
        filterCategory.value = currentCategory;
    }

    getFilteredExpenses() {
        const filterMonth = document.getElementById('filter-month').value;
        const filterCategory = document.getElementById('filter-category').value;

        return this.expenses.filter(e => {
            if (filterMonth) {
                const date = new Date(e.date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (monthKey !== filterMonth) return false;
            }
            if (filterCategory && e.category !== filterCategory) {
                return false;
            }
            return true;
        });
    }

    // ===== Render List =====
    renderList() {
        this.updateFilterOptions();
        const tbody = document.getElementById('expense-tbody');
        const emptyState = document.getElementById('empty-state');
        const table = document.getElementById('expense-table');
        const filteredTotal = document.getElementById('filtered-total');

        const filtered = this.getFilteredExpenses();

        if (filtered.length === 0) {
            table.style.display = 'none';
            emptyState.classList.add('show');
            filteredTotal.textContent = '¥0';
            return;
        }

        table.style.display = 'table';
        emptyState.classList.remove('show');

        // Sort by date (newest first)
        const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = sorted.map(expense => `
            <tr>
                <td>${this.formatDate(expense.date)}</td>
                <td><span class="category-badge">${expense.category}</span></td>
                <td>${expense.vendor || '-'}</td>
                <td class="text-right amount-cell">¥${expense.amount.toLocaleString()}</td>
                <td class="text-center">
                    <button class="delete-btn" onclick="app.deleteExpense(${expense.id})" title="削除">
                        🗑️
                    </button>
                </td>
            </tr>
        `).join('');

        // Calculate total
        const total = filtered.reduce((sum, e) => sum + e.amount, 0);
        filteredTotal.textContent = `¥${total.toLocaleString()}`;
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        return `${date.getMonth() + 1}/${date.getDate()}`;
    }

    // ===== Render Summary =====
    renderSummary() {
        this.renderTotalAmount();
        this.renderMonthlyChart();
        this.renderCategoryList();
    }

    renderTotalAmount() {
        const total = this.expenses.reduce((sum, e) => sum + e.amount, 0);
        document.getElementById('total-amount').textContent = `¥${total.toLocaleString()}`;

        // Update period
        if (this.expenses.length > 0) {
            const dates = this.expenses.map(e => new Date(e.date));
            const minDate = new Date(Math.min(...dates));
            const maxDate = new Date(Math.max(...dates));
            document.getElementById('summary-period').textContent =
                `${minDate.getFullYear()}年${minDate.getMonth() + 1}月〜${maxDate.getFullYear()}年${maxDate.getMonth() + 1}月`;
        }
    }

    renderMonthlyChart() {
        const container = document.getElementById('monthly-chart');

        // Group by month
        const monthlyData = {};
        this.expenses.forEach(e => {
            const date = new Date(e.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            monthlyData[key] = (monthlyData[key] || 0) + e.amount;
        });

        const months = Object.keys(monthlyData).sort().slice(-6); // Last 6 months
        const maxAmount = Math.max(...Object.values(monthlyData), 1);

        if (months.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">データがありません</p>';
            return;
        }

        container.innerHTML = months.map(month => {
            const [year, m] = month.split('-');
            const amount = monthlyData[month];
            const percentage = (amount / maxAmount) * 100;
            return `
                <div class="chart-bar">
                    <span class="chart-label">${parseInt(m)}月</span>
                    <div class="chart-bar-container">
                        <div class="chart-bar-fill" style="width: ${Math.max(percentage, 15)}%">
                            <span class="chart-bar-value">¥${amount.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderCategoryList() {
        const container = document.getElementById('category-list');

        // Group by category
        const categoryData = {};
        this.expenses.forEach(e => {
            if (e.category) {
                categoryData[e.category] = (categoryData[e.category] || 0) + e.amount;
            }
        });

        const sorted = Object.entries(categoryData).sort((a, b) => b[1] - a[1]);

        if (sorted.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">データがありません</p>';
            return;
        }

        container.innerHTML = sorted.map(([category, amount]) => `
            <div class="category-item">
                <span class="category-name">${category}</span>
                <span class="category-amount">¥${amount.toLocaleString()}</span>
            </div>
        `).join('');
    }

    // ===== Export =====
    initExport() {
        document.getElementById('export-csv-btn').addEventListener('click', () => {
            this.exportCSV();
        });

        // JSON export/import for device sync
        document.getElementById('export-json-btn').addEventListener('click', () => {
            this.exportJSON();
        });

        document.getElementById('import-json-btn').addEventListener('click', () => {
            document.getElementById('import-json-input').click();
        });

        document.getElementById('import-json-input').addEventListener('change', (e) => {
            this.importJSON(e);
        });
    }

    exportCSV() {
        if (this.expenses.length === 0) {
            this.showToast('エクスポートするデータがありません', 'error');
            return;
        }

        // やよいの青色申告オンライン形式
        // 必須項目: 日付, 入金, 出金
        // 経費なので「出金」に金額を入れる
        const headers = ['日付', '入金', '出金', '摘要'];
        const rows = this.expenses
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(e => {
                // 日付を YYYY/MM/DD 形式に変換
                const dateParts = e.date.split('-');
                const formattedDate = dateParts.length === 3
                    ? `${dateParts[0]}/${dateParts[1]}/${dateParts[2]}`
                    : e.date;

                // 摘要: カテゴリ + 店舗名 + メモ
                const description = [
                    e.category,
                    e.vendor,
                    e.memo
                ].filter(x => x).join(' / ');

                return [
                    formattedDate,  // 日付
                    '',             // 入金（経費なので空）
                    e.amount,       // 出金
                    description     // 摘要
                ];
            });

        // Add BOM for Excel compatibility
        let csvContent = '\uFEFF';
        csvContent += headers.join(',') + '\n';
        csvContent += rows.map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `やよい取込用_経費_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        this.showToast('やよい形式CSVをダウンロードしました！', 'success');
    }

    // JSON export for device sync
    exportJSON() {
        if (this.expenses.length === 0) {
            this.showToast('エクスポートするデータがありません', 'error');
            return;
        }

        const dataToExport = {
            version: 1,
            exportedAt: new Date().toISOString(),
            expenses: this.expenses.map(e => ({
                ...e,
                imageData: null // Don't include images to keep file small
            }))
        };

        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `経費データ_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);

        this.showToast('JSONをダウンロードしました！Googleドライブに保存してください。', 'success');
    }

    // JSON import for device sync
    importJSON(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                if (!data.expenses || !Array.isArray(data.expenses)) {
                    throw new Error('Invalid format');
                }

                // Merge with existing data (avoid duplicates by ID)
                const existingIds = new Set(this.expenses.map(exp => exp.id));
                let importedCount = 0;

                data.expenses.forEach(exp => {
                    if (!existingIds.has(exp.id)) {
                        this.expenses.push(exp);
                        importedCount++;
                    }
                });

                this.saveToStorage();
                this.renderList();
                this.renderSummary();

                this.showToast(`${importedCount}件の経費をインポートしました！`, 'success');
            } catch (error) {
                console.error('Import error:', error);
                this.showToast('ファイルの読み込みに失敗しました', 'error');
            }
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    }

    // ===== Toast =====
    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.querySelector('.toast-message').textContent = message;
        toast.className = `toast ${type} show`;

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }
}

// Initialize app
const app = new ReceiptManager();
