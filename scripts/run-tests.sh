#!/bin/bash

# Automated Test Runner for Enclave MVP
# Usage: ./scripts/run-tests.sh [smoke|full|ci]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[$(date +'%H:%M:%S')]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if test type is provided
TEST_TYPE=${1:-smoke}

print_status "🚀 Starting Enclave MVP Automated Tests"
print_status "Test Type: $TEST_TYPE"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

# Check if Playwright is installed
if [ ! -d "node_modules/@playwright" ]; then
    print_warning "Playwright not found. Installing..."
    npm install
    npx playwright install
fi

# Set environment variables for testing
export BASE_URL=${BASE_URL:-"http://localhost:3000"}
export TEST_EMAIL=${TEST_EMAIL:-"test@example.com"}
export TEST_PASSWORD=${TEST_PASSWORD:-"testpassword"}

print_status "Environment:"
print_status "  BASE_URL: $BASE_URL"
print_status "  TEST_EMAIL: $TEST_EMAIL"

# Function to run smoke tests
run_smoke_tests() {
    print_status "Running smoke tests (5 minutes)..."
    
    npx playwright test tests/e2e/smoke-test.spec.ts \
        --project=chromium \
        --reporter=list,html \
        --output-dir=test-results/smoke
    
    if [ $? -eq 0 ]; then
        print_success "Smoke tests passed!"
        return 0
    else
        print_error "Smoke tests failed!"
        return 1
    fi
}

# Function to run full test suite
run_full_tests() {
    print_status "Running full test suite (30 minutes)..."
    
    npx playwright test tests/e2e/full-test-suite.spec.ts \
        --project=chromium \
        --reporter=list,html \
        --output-dir=test-results/full
    
    if [ $? -eq 0 ]; then
        print_success "Full test suite passed!"
        return 0
    else
        print_error "Full test suite failed!"
        return 1
    fi
}

# Function to run CI tests
run_ci_tests() {
    print_status "Running CI tests (headless, all browsers)..."
    
    npx playwright test \
        --project=chromium --project=firefox --project=webkit \
        --reporter=list,junit \
        --output-dir=test-results/ci
    
    if [ $? -eq 0 ]; then
        print_success "CI tests passed!"
        return 0
    else
        print_error "CI tests failed!"
        return 1
    fi
}

# Function to generate test report
generate_report() {
    print_status "Generating test report..."
    
    # Create reports directory
    mkdir -p test-reports
    
    # Generate HTML report
    npx playwright show-report test-results/smoke --port 9323 &
    
    print_status "Test report available at: http://localhost:9323"
    print_status "Test results saved in: test-results/"
}

# Main execution
case $TEST_TYPE in
    "smoke")
        if run_smoke_tests; then
            generate_report
            print_success "🎉 All smoke tests passed! Ready to deploy."
            exit 0
        else
            print_error "💥 Smoke tests failed! Fix issues before deploying."
            exit 1
        fi
        ;;
    
    "full")
        if run_full_tests; then
            generate_report
            print_success "🎉 All tests passed! System is fully functional."
            exit 0
        else
            print_error "💥 Tests failed! Review results and fix issues."
            exit 1
        fi
        ;;
    
    "ci")
        if run_ci_tests; then
            print_success "🎉 All CI tests passed!"
            exit 0
        else
            print_error "💥 CI tests failed!"
            exit 1
        fi
        ;;
    
    *)
        print_error "Invalid test type: $TEST_TYPE"
        print_status "Usage: $0 [smoke|full|ci]"
        print_status "  smoke - Quick 5-minute test (default)"
        print_status "  full  - Complete 30-minute test suite"
        print_status "  ci    - CI/CD tests for all browsers"
        exit 1
        ;;
esac
